# 课时 10：混合精度、数值病理学与性能 Profiling

## 目标

1. 从字节级显存账本、反向传播缓存与优化器状态的物理开销理解 OOM，而不是把“减小 batch size”当作唯一药方。
2. 深入理解 FP32、FP16、BF16 的位级结构、动态范围、有效精度与数值病理，明确混合精度为什么会同时带来提速与灾难。
3. 手推 GradScaler 的动态缩放机制，理解它为什么只是对抗 FP16 下溢的数值工程补丁，而不是“自动变聪明”的训练魔法。
4. 理解梯度累加的数学近似条件、失效边界以及它与 BatchNorm、Dropout、日志粒度、学习率解释之间的耦合关系。
5. 建立工业级性能剖析方法论，学会用 CUDA 同步、峰值显存、吞吐、核函数时间占比与数据管道瓶颈定位真实性能上限。

## 推导

### 一、OOM 不是一句报错，而是一张显存资产负债表

大多数人看到 `CUDA out of memory` 的第一反应是缩小 batch size，但真正的工程师必须先写出显存账单。训练时显存占用可近似拆成：
$$
\text{Memory} \approx M_{\text{param}} + M_{\text{grad}} + M_{\text{opt}} + M_{\text{act}} + M_{\text{misc}}
$$

其中：

1. $M_{\text{param}}$：模型参数本体
2. $M_{\text{grad}}$：参数对应梯度
3. $M_{\text{opt}}$：优化器状态
4. $M_{\text{act}}$：反向传播需要保留的中间激活
5. $M_{\text{misc}}$：CUDA kernel workspace、临时 buffer、碎片化开销等

对于参数量为 $N$ 的模型，若参数采用 FP32，则：

1. 参数本体约占 $4N$ bytes
2. 梯度张量约占 $4N$ bytes
3. SGD 典型额外状态较少；Momentum 多一个速度项，约再加 $4N$ bytes
4. Adam/AdamW 需要一阶矩与二阶矩，约再加 $8N$ bytes

因此仅看参数相关开销，Adam 系优化器往往可写成：
$$
M_{\text{param+grad+opt}} \approx 4N + 4N + 8N = 16N\ \text{bytes}
$$

这还没有算最致命的激活缓存。若某层输出形状为：
$$
B \times C \times H \times W
$$

且 dtype 占用 $b$ bytes，则其激活显存近似为：
$$
M_{\text{act,layer}} \approx B \cdot C \cdot H \cdot W \cdot b
$$

这解释了两个课堂必须打穿的问题：

1. 为什么 batch size 对显存的杀伤远大于很多超参？因为它线性放大多层激活缓存。
2. 为什么推理往往能跑更大 batch，而训练不行？因为推理不需要为反向传播保留整条计算图的激活。

进一步要让学生理解：

1. OOM 有时不是“理论总量超了”，而是 CUDA allocator 碎片化导致大块连续内存申请失败。
2. 显存优化从来不是单点技巧，而是参数、激活、优化器、checkpointing、精度格式协同设计。
3. 混合精度真正省下来的，往往首先是激活和部分算子中间张量，而不是所有状态都自动减半。

### 二、浮点数不是“精度高低”的故事，而是范围与分辨率的战争

IEEE 754 浮点数可写为：
$$
x = (-1)^s \times 2^{e-\text{bias}} \times (1.f)
$$

其中：

1. $s$ 是符号位
2. $e$ 是指数位
3. $f$ 是尾数位

三种常见格式如下：

1. `FP32`：`1/8/23`，动态范围大、精度较均衡
2. `FP16`：`1/5/10`，尾数不算太差，但指数位极少，范围极窄
3. `BF16`：`1/8/7`，指数与 FP32 同级，但尾数更短，分辨率更粗

课堂不能停留在“FP16 更省显存”这种层面，必须进入数值病理：

#### 1. FP16 的真正致命点是指数位太少

`FP16` 的最大有限值约为：
$$
65504
$$

最小正常正数约为：
$$
6.10\times 10^{-5}
$$

若考虑次正规数，下界还能更小，但在大量硬件路径下，小数值依然极易被 flush-to-zero。于是：

1. 数值过大时直接变成 `Inf`
2. 数值过小时直接坍缩为 `0`
3. 梯度不是“更粗糙一点”，而是可能整个坐标被湮灭

#### 2. BF16 的哲学是“宁可粗一点，也别炸范围”

`BF16` 保留了 FP32 的 8 位指数，因此动态范围接近 FP32：

1. 不容易发生 FP16 式的上下溢
2. 很多场景下无需 `GradScaler`
3. 但尾数更短，意味着可分辨的相邻数间距更大，数值更新更像粗颗粒台阶

课堂必须让学生看见真正的权衡：

1. `FP16` 更像高分辨率但窄走廊的刻度尺
2. `BF16` 更像低分辨率但超大测量范围的尺子
3. 深度学习训练往往更害怕“走廊太窄”而不是“刻度稍粗”

### 三、AMP 真正改变了什么：不是所有算子都降精度，也不是所有路径都更快

混合精度训练并不等于“全模型半精度”。更准确地说，它是在自动类型调度：

1. 对吞吐敏感、数值相对安全的算子，优先使用低精度
2. 对数值敏感的算子，回退到 FP32
3. 保持一部分主权重或关键累加过程在更高精度中完成

这意味着 `autocast` 的本质不是“统一 cast”，而是“按算子白名单/黑名单做选择性降精度”。课堂要让学生理解：

1. AMP 是一套精度调度策略，不是单个 API
2. 性能提升通常来自 Tensor Core 等硬件路径被激活，而不是简单因为位宽小
3. 若模型瓶颈在数据加载、CPU 预处理或 host-to-device copy，AMP 可能几乎不带来吞吐提升

更硬核一点的结论是：

1. 若算子没有走到高吞吐低精度 kernel，AMP 可能只增加类型转换开销
2. Profiling 不做同步测量，很多“AMP 提速”都只是错觉
3. 真正的优化对象不是 `autocast` 开关，而是整条训练流水线的瓶颈结构

### 四、GradScaler：一场为拯救 FP16 下溢而发明的动态数值补丁

在 FP16 下，反向传播后期的梯度常常极小。若原始 loss 为 $\mathcal{L}$，梯度为：
$$
\mathbf{g}=\nabla_\theta \mathcal{L}
$$

则 GradScaler 先构造缩放后的 loss：
$$
\tilde{\mathcal{L}} = s \mathcal{L}
$$

根据链式法则：
$$
\nabla_\theta \tilde{\mathcal{L}} = s \nabla_\theta \mathcal{L} = s\mathbf{g}
$$

若原本某个梯度分量为 $10^{-6}$，当 $s=2^{16}$ 时，它会被抬升到更接近 FP16 可安全表达的区域。之后在 `optimizer.step()` 前再做 unscale：
$$
\frac{1}{s}(s\mathbf{g})=\mathbf{g}
$$

所以 GradScaler 的逻辑不是改变优化目标，而是改变梯度在有限位宽下的暂时表达尺度。

PyTorch 的动态缩放可理解为一台离散状态机：
$$
s_{t+1}=G(s_t,\text{found\_inf}_t,\text{growth\_tracker}_t)
$$

其中：

1. 若连续若干 step 没有发现 `Inf/NaN`，尝试增大 $s_t$
2. 若当前 step 检测到溢出，则跳过参数更新，并降低 $s_t$
3. 缩放因子本身也是训练状态，断点恢复时若不保存，会破坏接续轨迹

课堂必须强制学生形成三条认知：

1. GradScaler 不是自动调学习率
2. GradScaler 不会提高数学精度，只是避免梯度在 FP16 中被提前打成 0
3. 如果看到 `step skipped`，那不是框架抽风，而是数值安全机制在自救

### 五、梯度累加不是纯代数等价，而是带条件的工程近似

若单卡无法承受目标 batch size，可将一个大 batch 拆成多个 micro-batch。设：

1. micro batch size 为 $B_\mu$
2. 累加步数为 $K$
3. GPU 数量为 $G$

则有效批大小为：
$$
B_{\text{eff}} = B_\mu \times K \times G
$$

若每个 micro-batch 的 loss 都做均值，并在反向前额外除以 $K$：
$$
\mathcal{L}_{\text{micro,scaled}}=\frac{1}{K}\mathcal{L}_{\text{micro}}
$$

那么累计 $K$ 次后，参数梯度近似等于真实大 batch 梯度。

但这里必须加入高压约束：

1. 若模型含有 `BatchNorm` 等跨 batch 统计层，micro-batch 统计量与大 batch 并不等价
2. 若存在 dropout、随机增强、采样波动，轨迹也只能近似而非严格一致
3. 日志中的一个 `step` 不再等于一次权重更新，而可能只是一次 micro-step
4. 学习率调度器若按 step 更新，就必须重新定义 step 的语义

因此更精确的课堂表述应是：

1. 梯度累加在“无跨 batch 状态耦合 + 正确缩放 loss”的条件下，近似等价于大 batch
2. 它省的是瞬时激活显存，不是白送吞吐
3. 很多时候你用梯度累加换来的只是“能跑”，而不是“更快”

### 六、性能 Profiling 的第一原则：不做 CUDA 同步，你测到的大概率是假时间

GPU kernel 执行默认是异步的。若直接用 Python `time.time()` 包住前向和反向，很可能只测到了 CPU 发指令的时间，而没有测到 GPU 真正算完的时间。因此：

1. 在关键计时点前后必须调用 `torch.cuda.synchronize()`
2. 或使用 `torch.cuda.Event(enable_timing=True)` 做更细粒度的设备侧计时

这节课要让学生建立三层 Profiling 指标体系。

#### 第一层：训练脚本级核心指标

1. `step_time_ms`
2. `samples_per_second` 或 `tokens_per_second`
3. `peak_memory_mb`

吞吐可写为：
$$
\text{Throughput} = \frac{B_{\text{eff}}}{\text{step\_time (s)}}
$$

#### 第二层：流水线拆分指标

1. 数据准备时间
2. CPU -> GPU 拷贝时间
3. 前向时间
4. 反向时间
5. optimizer step 时间

#### 第三层：Profiler / Nsight 级指标

1. CUDA kernel 时间分布
2. GPU 利用率与空转比例
3. Tensor Core kernel 是否真正被触发
4. 数据管道是否成为瓶颈

课堂必须明确反复打击两个误区：

1. “epoch 更快”不等于“step 更快”，因为 batch size 和有效步数可能变了
2. “GPU 利用率高”也不等于“训练高效”，因为可能只是错误的同步方式或数据拷贝堆积

## 实操

### 任务一：手写显存账单，定位 OOM 的真正元凶

要求学生：

1. 为当前模型估算参数、梯度、优化器状态的理论显存占用。
2. 运行一轮前向与反向，分别记录：
   - `torch.cuda.memory_allocated()`
   - `torch.cuda.max_memory_allocated()`
   - 不同 batch size 下的峰值显存
3. 对比 SGD 与 AdamW 两种优化器，解释显存差异。
4. 回答为什么训练阶段的激活缓存通常才是显存大头。

课堂观察重点：

1. 学生是否会把 OOM 直接归咎于“模型参数太多”
2. 学生是否能把理论账单与真实监控对齐
3. 学生是否理解 allocator 碎片化与临时 workspace 的存在

### 任务二：构建 FP32 / FP16 / BF16 三路数值对照实验

要求学生：

1. 在同一模型、同一输入下分别运行：
   - 纯 FP32
   - AMP(FP16)
   - AMP(BF16，若硬件支持)
2. 对比并记录：
   - loss 是否稳定
   - 梯度范数分布
   - 是否出现 `NaN/Inf`
   - 峰值显存与吞吐
3. 故意放大学习率或 logits，诱发 FP16 数值病理。
4. 观察 BF16 是否更稳，并解释它“更稳但更粗”的原因。

建议使用文件：

- `模块二_pytorch与深度学习训练闭环/代码示例/07_AMP与梯度累加训练脚本_amp_accum_train.py`

### 任务三：GradScaler 动态机制逆向实验

要求学生：

1. 接入 `torch.autocast` 与 `GradScaler`
2. 在训练中持续记录：
   - 当前 `scale`
   - 是否发生 `found_inf`
   - 是否跳过 `optimizer.step()`
3. 设计一次故意的数值爆炸实验，观察缩放因子如何退避
4. 解释为什么 `scale` 的变化与学习率变化不是一回事

课堂观察重点：

1. 学生是否能把 `GradScaler` 视作状态机而不是黑盒
2. 学生是否能解释 “skip step” 的工程语义
3. 学生是否意识到 resume 时必须恢复 scaler 状态

### 任务四：用梯度累加救活 OOM，并审判它的等价边界

要求学生：

1. 先构造一个会 OOM 的目标 batch 设置。
2. 改写为 `micro-batch + accumulation` 版本。
3. 正确处理 loss 缩放：
   - 每个 micro-batch 的 loss 除以 `accumulation_steps`
4. 对比：
   - 是否能跑通
   - 每次权重更新的 step time
   - 总吞吐
   - 学习率调度器和日志粒度是否需要改写
5. 若模型含 BatchNorm，额外分析为什么它与真实大 batch 不严格等价。

### 任务五：做一次真正可信的性能 Profiling

要求学生：

1. 使用 CUDA 同步或 `torch.cuda.Event` 计时，而不是直接用裸 `time.time()`
2. 对以下三种脚本做最小基准：
   - FP32
   - AMP
   - AMP + 梯度累加
3. 记录：
   - 平均 `step_time_ms`
   - `samples/s`
   - `peak_memory_mb`
   - 前向 / 反向 / 数据拷贝时间占比
4. 若条件允许，使用 `torch.profiler` 输出 trace，并定位瓶颈更像是：
   - DataLoader
   - H2D copy
   - CUDA compute
   - optimizer step

## 验收标准

1. 学生必须能写出训练显存的主要组成，并解释为什么 AdamW 比 SGD 更吃显存。
2. 必须能从指数位和尾数位角度解释 FP16 与 BF16 的差异，而不是只会说“一个更稳”。
3. 必须能说明 FP16 的典型失败模式是下溢与上溢，而不是笼统地说“精度差”。
4. 必须完整解释 GradScaler 的放大、反传、unscale、溢出检测与 step skip 机制。
5. 必须完成一次 AMP 与非 AMP 的性能对照，并使用正确的 CUDA 同步计时方法。
6. 必须完成一次梯度累加拯救 OOM 的实验，并说明它与真实大 batch 的等价条件与失效边界。
7. 提交内容中必须同时包含 `step_time`、吞吐、峰值显存，以及至少一个数值异常或瓶颈定位案例。
8. 若 resume 训练时启用了 AMP，必须能说明为什么 scaler 状态也属于需要保存的训练状态。

## 当堂交付物

1. 一份支持 AMP、GradScaler、梯度累加与性能计时的工业级单卡训练脚本。
2. 一份显存账单分析记录，明确区分参数、梯度、优化器状态与激活缓存。
3. 一份 FP32 / FP16 / BF16 对照实验表，至少包含：
   - 是否稳定
   - `step_time_ms`
   - `samples/s`
   - `peak_memory_mb`
4. 一份 GradScaler 动态行为记录，展示 `scale` 变化与 step skip 现象。
5. 一份最小性能 Profiling 报告，明确瓶颈位于数据、拷贝、计算还是优化器阶段。
