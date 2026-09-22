# 课时 11：泛化拓扑、隐式正则化与病态 Loss 外科手术

## 目标

1. 从平坦极小值、局部曲率与分布扰动稳定性的角度重新定义“泛化”，而不是把它简化为训练集和验证集分数差。
2. 严格区分 L2 regularization 与 Weight Decay，在 Adam 类自适应优化器中推导其等价性的崩塌，并理解 AdamW 的数学必然性。
3. 从信噪比（SNR）、贝叶斯近似与子流形采样角度理解 Dropout、数据增强与 Weight Decay 的真实作用边界。
4. 建立“Loss 轨迹断层扫描”式的病态训练诊断框架，把曲线、梯度范数、权重范数与 bad case 统一进一棵决策树。
5. 强化 Data-centric AI 的纪律：在未排查数据分布、标注噪声与类别失衡前，禁止盲目更换 backbone 或堆叠结构复杂度。

## 推导

### 一、泛化不是训练误差低，而是对扰动不敏感的局部几何稳定性

训练中我们常写经验风险最小化：
$$
\min_{\theta} \mathcal{R}_{train}(\theta)
$$

但真正关心的是泛化间隙：
$$
\mathcal{R}_{test}(\theta)-\mathcal{R}_{train}(\theta)
$$

若把训练收敛点 $\theta^\star$ 附近的损失做二阶近似：
$$
\mathcal{L}(\theta^\star+\delta)\approx \mathcal{L}(\theta^\star)+\frac{1}{2}\delta^\top \mathbf{H}(\theta^\star)\delta
$$

则 Hessian 的谱就给出了局部几何稳定性：

1. 若最大特征值很大，则该极小值周围像针眼或峡谷，参数稍微被扰动就会导致 loss 暴涨。
2. 若主要特征值较小，则该区域更平坦，模型对参数噪声与轻微分布偏移更稳。
3. 所谓 flat minima，至少在局部上意味着对扰动有更低的曲率敏感性。

课堂要让学生明确两个高级认知：

1. “平坦极小值泛化更好”是轨迹偏置与稳定性直觉，不是脱离参数化方式的绝对定理。
2. 正则化真正要做的，不只是把权重变小，而是偏置训练轨迹远离那些高曲率、尖锐且脆弱的盆地。

更物理的表述是：

1. 输入扰动、参数扰动、标注噪声，都会通过高曲率方向被放大。
2. 泛化差的模型，本质上常常是局部稳定性差。
3. 因此泛化问题不是“测试集运气不好”，而是参数点所在流形邻域过于脆弱。

### 二、L2 Regularization 与 Weight Decay：SGD 时代的等价幻觉，Adam 时代的数学崩塌

这是本节课必须打穿的核心。

若目标函数带 L2 项：
$$
\mathcal{L}_{reg}(\theta)=\mathcal{L}(\theta)+\frac{\lambda}{2}\|\theta\|_2^2
$$

则梯度为：
$$
\nabla \mathcal{L}_{reg}(\theta)=\nabla \mathcal{L}(\theta)+\lambda \theta
$$

在普通 SGD 中，更新为：
$$
\theta_{t+1}=\theta_t-\alpha(\nabla \mathcal{L}(\theta_t)+\lambda\theta_t)
$$
$$
= (1-\alpha\lambda)\theta_t-\alpha \nabla \mathcal{L}(\theta_t)
$$

所以在 SGD 中，L2 正则与 Weight Decay 完全等价。

但 Adam 的问题在于它不是用标量学习率更新，而是用坐标级预条件器：
$$
\mathbf{D}_t=\mathrm{diag}\left(\frac{1}{\sqrt{\hat{\mathbf{v}}_t}+\epsilon}\right)
$$

若把 L2 项直接塞进梯度，Adam 实际执行：
$$
\theta_{t+1}=\theta_t-\alpha \mathbf{D}_t\left(\hat{\mathbf{m}}_t+\lambda\theta_t\right)
$$
$$
=\theta_t-\alpha \mathbf{D}_t\hat{\mathbf{m}}_t-\alpha\lambda \mathbf{D}_t\theta_t
$$

问题就在最后一项：

1. 真正的 Weight Decay 应该是各坐标统一的径向收缩：
$$
\theta_{t+1}=(1-\alpha\lambda)\theta_t-\alpha\mathbf{D}_t\hat{\mathbf{m}}_t
$$
2. 但塞入 L2 后，衰减项被变成了 $\mathbf{D}_t\theta_t$。
3. 这意味着不同坐标受到的衰减强度被二阶矩重新加权，完全失去公平性。

于是：

1. 梯度大、二阶矩也大的坐标，L2 惩罚反而会被稀释。
2. 梯度小的坐标，可能被相对更强地收缩。
3. L2 失去的是“统一向原点收缩”的几何意义。

这里要把课时 8 的结论进一步推进到泛化层面：

1. 若正则项在不同坐标上被自适应学习率扭曲，优化器就不再是在做统一的几何收缩。
2. 这会破坏用参数范数约束高曲率解的能力。
3. AdamW 的关键不是“小修小补”，而是把几何意义被破坏的那一项重新拉出来。

AdamW 的更新形式是：
$$
\theta_{t+1}=\theta_t-\alpha\mathbf{D}_t\hat{\mathbf{m}}_t-\alpha\lambda\theta_t
$$

这才恢复了衰减项与预条件器解耦的结构。

更进一步，若从小学习率极限和随机梯度噪声出发，将离散更新近似为连续时间随机微分方程（SDE），可以看到：

1. SGD + Weight Decay 对应的是带各向同性收缩项的漂移过程。
2. Adam 中把 L2 塞进梯度后，该收缩项会被预条件矩阵扭曲成各向异性的漂移。
3. 这说明“L2 与 Weight Decay 等价”在 Adam 中不是实现问题，而是对应的连续时间动力学已经不同。

课堂应要求学生至少能口头复述：

1. SGD 里 L2 与 Weight Decay 等价，是因为学习率是标量。
2. Adam 里这种等价性被坐标级预条件器摧毁。
3. AdamW 的价值在于恢复了正确的几何收缩方向。

### 三、Dropout、数据增强与 SNR：它们不是经验技巧，而是在改写有效后验与梯度信噪比

#### 1. Dropout 是对子网络集合做蒙特卡洛采样

设某层激活为 $\mathbf{h}$，Dropout mask 为：
$$
\mathbf{m}\sim \mathrm{Bernoulli}(p)
$$

训练时输出可写为：
$$
\tilde{\mathbf{h}}=\frac{\mathbf{m}\odot \mathbf{h}}{p}
$$

这就是 inverted dropout。于是：
$$
\mathbb{E}[\tilde{\mathbf{h}}]=\mathbf{h}
$$

这解释了为什么训练期随机丢弃，测试期却不需要再随机：

1. 训练期是在指数级子网络上做近似采样与平均。
2. 测试期用期望对齐来近似这些子网络的集成预测。
3. 它迫使模型不要把表示完全绑定到某几个脆弱神经元通道上。

#### 2. 为什么 Dropout 有时有效，有时反而伤模型

课堂必须反直觉地告诉学生：

1. Dropout 不是对所有任务都有效。
2. 若数据本身低噪声、低维、样本少，过强 dropout 会直接破坏本就稀缺的有效信号。
3. 在某些卷积或时序任务中，它甚至会降低表征连续性。

#### 3. 用 SNR 视角理解正则化

随机梯度可写为：
$$
\mathbf{g}_t = \nabla \mathcal{L}(\theta_t) + \boldsymbol{\xi}_t
$$

其中 $\boldsymbol{\xi}_t$ 是噪声项。可粗略把梯度信噪比写为：
$$
\mathrm{SNR}_t \propto \frac{\|\mathbb{E}[\mathbf{g}_t]\|}{\sqrt{\mathrm{Var}(\mathbf{g}_t)}}
$$

这节课要让学生建立的认知是：

1. 小 batch、脏标签、类别极不均衡都会拉低 SNR。
2. Dropout 和数据增强不是简单“造难题”，而是在牺牲一部分拟合速度的同时，换取更稳的后验偏置。
3. Weight Decay 则像是在参数空间里抑制高能量解，降低模型对偶然噪声模式的放大能力。

所以正则化不是一个按钮，而是三类不同干预：

1. 对参数几何做约束：Weight Decay
2. 对子网络结构做随机采样：Dropout
3. 对输入流形做扰动扩张：Data Augmentation

### 四、病态 Loss 不只是曲线不好看，而是优化动力系统在发病

这节课必须把“看 loss 曲线调参”升级成“做动力系统临床诊断”。

最少要同时监控四类量：

1. `train_loss`
2. `val_loss`
3. `gradient_norm`
4. `weight_norm`

因为只看 loss，经常无法区分“卡死”与“震荡”。

典型病理模式：

#### 1. `train_loss` 降极慢，`val_loss` 也不动

可能原因：

1. 学习率过低
2. 梯度消失
3. 数据管道错误
4. 标签或损失构造有 bug

对应动作：

1. 先看 `gradient_norm` 是否接近 0
2. 检查是否忘记 `zero_grad`
3. 检查输入、标签、损失是否存在 NaN
4. 检查最后一层输出与损失函数是否匹配

#### 2. `train_loss` 暴降，但 `val_loss` 快速 U 型反弹

可能原因：

1. 经典过拟合
2. 模型掉入 sharp minima
3. 数据量太小或增强不足
4. 权重衰减过弱或完全失效

对应动作：

1. 先增强数据与清洗 bad case
2. 再提高 Weight Decay，且必须确认优化器使用 `AdamW`
3. 再考虑 Dropout 或减少模型容量

#### 3. `train_loss` 像心电图一样强震荡

可能原因：

1. 学习率越过局部曲率允许上界
2. batch 太小，梯度噪声方差过大
3. 数据分布混乱或标签噪声极高
4. AMP 数值不稳定

对应动作：

1. 同步查看 `gradient_norm` 是否周期性爆炸
2. 做梯度裁剪
3. 增大 batch 或用梯度累加提高有效 batch
4. 回查是否存在异常样本或错误增强

#### 4. 验证集预测几乎全为同一类

这是必须全场拉警报的 Data-centric 场景。

优先诊断：

1. 类别分布是否极端长尾
2. 标签映射是否错乱
3. sampler 是否有偏
4. 指标代码是否写错

课堂纪律必须写死：

1. 看到这一类症状，先停掉“换模型”冲动。
2. 先回查数据集、标签表、类别采样和 bad case。
3. 没有数据证据前，禁止把问题归咎于 backbone 不够强。

### 五、Data-centric AI 的钢铁纪律：先查流形，再谈结构

本课必须建立一条几乎苛刻的决策顺序：

1. 数据分布是否可信
2. 标注是否一致
3. 类别是否失衡
4. 采样是否合理
5. 增强是否破坏流形
6. 正则是否失衡
7. 最后才轮到模型结构

更强的课堂表达是：

1. 高级工程师不是更会换模型，而是更晚换模型。
2. 真正浪费算力的不是“训练太久”，而是在错误数据流形上反复调 backbone。
3. 没有 bad case 系统与诊断树的调参，基本等于黑箱炼丹。

## 实操

### 任务一：数学打假 - Adam 与 AdamW 的正则化陷阱验证

要求学生：

1. 构造一个最小回归模型，显式制造两组参数：
   - `w_fast`：梯度尺度大
   - `w_slow`：梯度尺度小
2. 在相同 `lambda` 下，分别使用：
   - `torch.optim.Adam`
   - `torch.optim.AdamW`
3. 记录两组参数的范数衰减轨迹。
4. 证明在普通 Adam 中，不同坐标上的正则化力度会被二阶矩不公平稀释。

建议交付文件：

- `task_01_adam_vs_adamw_regularization_trap.py`

### 任务二：Vibe Coding 开发 Loss 轨迹断层扫描仪

要求学生：

1. 不允许只写 `print(loss)`。
2. 利用 Vibe Coding 生成并手工审查 `TelemetryCallback`，要求至少记录：
   - `train_loss`
   - `val_loss`
   - `gradient_norm`
   - `weight_norm`
   - `learning_rate`
3. 将记录结果保存为 CSV、图像或 W&B/TensorBoard 面板。
4. 注入一份带噪声标签或类别失衡问题的数据集，观察遥测面板中的异常形态。

建议交付文件：

- `task_02_telemetry_callback.py`

### 任务三：病态日志会诊与手术方案设计

要求学生：

1. 教师提供 3 份匿名训练日志：
   - 日志 A：`val_loss` U 型反弹
   - 日志 B：loss 极平、梯度接近 0
   - 日志 C：周期性 spike
2. 学生必须为每份日志提交结构化《病危诊断书》，包括：
   - 现象描述
   - 最可能病因
   - 证据链
   - 优先级排序后的修复方案
3. 修复方案中必须先写数据与采样层面的检查项，再写模型层面的改动。

建议交付文件：

- `task_03_pathology_reports.md`

### 任务四：Dropout、Weight Decay 与数据增强的对照实验

要求学生：

1. 至少对比四组设置：
   - 无正则
   - 仅 `AdamW`
   - `AdamW + Dropout`
   - `AdamW + Data Augmentation`
2. 对比：
   - 训练曲线
   - 验证曲线
   - 梯度范数
   - 最终 bad case
3. 解释哪种方法更像是在修复高曲率过拟合，哪种更像是在提升输入分布鲁棒性。

建议交付文件：

- `task_04_regularization_ablation.py`

## 验收标准

1. 学生必须能写出局部二次近似，并解释 flat minima 与 sharp minima 的几何差异。
2. 必须能在白板上推导出 Adam 中 L2 正则项为何会被 $\mathbf{D}_t$ 扭曲，并说明 AdamW 如何恢复解耦的几何收缩。
3. 必须能解释 Dropout 的期望对齐与子网络采样思想，而不是只会说“随机丢神经元防过拟合”。
4. 必须能用 SNR 视角解释为什么小 batch、噪声标签和类别失衡会让训练轨迹更病态。
5. `TelemetryCallback` 必须能自动记录 `gradient_norm` 与 `weight_norm`，因为这是区分“卡死”“过拟合”“爆炸震荡”的关键证据。
6. 必须完成至少一组 `Adam vs AdamW` 的验证实验，并提交参数衰减轨迹图。
7. 提交的诊断报告必须体现 Data-centric AI 的优先级，若一上来就建议“换模型”，视为诊断逻辑不合格。
8. 必须输出一份结构化病态 Loss 决策树，能覆盖过拟合、欠拟合、数值不稳、数据异常与类别失衡五类情形。

## 当堂交付物

1. 一份病态 Loss 诊断决策树。
2. 一份 `Adam vs AdamW` 正则化陷阱验证报告与轨迹图。
3. 一份 `TelemetryCallback` 遥测系统实现。
4. 一份 bad case 与训练日志联合分析记录。
5. 一份“最可能浪费时间的三类调参误区”总结，其中必须体现 Data-centric AI 的反黑箱纪律。
