# 课时 7：仿射拓扑、流形映射与 Autograd 动态图引擎逆向工程

## 目标

1. 跃出“层”的 API 视角，将 `nn.Linear` 理解为高维流形上的仿射投影，理解初始化与方差传播的体积守恒条件。
2. 逆向工程 PyTorch 的反向模式自动微分（Reverse-Mode AutoDiff）引擎，理解拓扑排序、向量-雅可比积与反向传播的本质等价性。
3. 破解动态计算图的内存生命周期，严格区分 `.detach()`、`torch.no_grad()`、`retain_graph=True` 在底层图构建和显存释放上的差异。
4. 从 Jacobian 奇异值与谱范数视角，严谨推导 Sigmoid 梯度饱和与 ReLU 神经元死亡的数学机制。
5. 运用 Vibe Coding 编写系统级计算图扫描探针，将 Autograd 黑盒编译为可视化的有向无环图（DAG）。

## 推导

### 一、仿射变换不是“线性层接口”，而是高维流形的投影算子

设输入矩阵 $\mathbf{X}\in\mathbb{R}^{N\times d_{in}}$，权重矩阵 $\mathbf{W}\in\mathbb{R}^{d_{in}\times d_{out}}$，偏置 $\mathbf{b}\in\mathbb{R}^{d_{out}}$，则前向传播为：
$$
\mathbf{Z}=\mathbf{X}\mathbf{W}+\mathbf{b}
$$

但这不是简单的加乘法，而是：

1. $\mathbf{W}$ 对输入流形进行旋转、拉伸、压缩。
2. $\mathbf{b}$ 完成整体平移。
3. 多层网络是在重复做“局部坐标变换 + 非线性折叠”。

课堂的破壁点不在“会写公式”，而在于看清方差危机。

若假设输入特征与权重独立同分布、均值为 0，则单层输出方差近似满足：
$$
\mathrm{Var}(z)\approx d_{in}\,\mathrm{Var}(x)\,\mathrm{Var}(w)
$$

这意味着：

1. 若 $d_{in}\mathrm{Var}(w)\gg 1$，方差在深层网络中指数爆炸。
2. 若 $d_{in}\mathrm{Var}(w)\ll 1$，方差在深层网络中指数塌缩。

于是自然引出：

1. 为什么 Xavier / Kaiming 初始化并不是经验公式，而是方差守恒条件。
2. 为什么深层网络训练的第一步不是调学习率，而是先保证前向传播不过早失真。

### 二、复合函数、VJP 与反向模式自动微分

考虑两层 MLP：
$$
\mathbf{H}=\phi(\mathbf{X}\mathbf{W}_1+\mathbf{b}_1), \quad
\mathbf{\hat{Y}}=\mathbf{H}\mathbf{W}_2+\mathbf{b}_2
$$

最终损失记为：
$$
\mathcal{L}(\mathbf{\hat{Y}},\mathbf{Y})
$$

整个系统是一个多层复合函数：
$$
\mathcal{L}\circ f_2\circ\phi\circ f_1
$$

理论上，完整 Jacobian 极其庞大。深度学习框架并不会显式构造：
$$
\mathbf{J}=\frac{\partial \mathbf{\hat{Y}}}{\partial \theta}
$$

真正执行的是向量-雅可比积（Vector-Jacobian Product, VJP）：
$$
\mathbf{v}^T\mathbf{J}
$$

这就是为什么反向模式自动微分在“输入维度巨大、输出为标量 loss”的场景中统治现代深度学习。

课堂要求学生建立以下认知：

1. 前向微分适合输入维度小、输出维度大。
2. 反向微分适合输入参数海量、输出为单个 loss。
3. PyTorch 的 `backward()` 本质上是在执行一串局部 VJP，而不是在算“完整导数矩阵”。

### 三、链式法则与局部 Jacobian 的高维拼接

输出层梯度：
$$
\frac{\partial \mathcal{L}}{\partial \mathbf{W}_2}
=
\mathbf{H}^T
\frac{\partial \mathcal{L}}{\partial \mathbf{\hat{Y}}}
$$

隐藏层误差信号：
$$
\frac{\partial \mathcal{L}}{\partial \mathbf{H}}
=
\frac{\partial \mathcal{L}}{\partial \mathbf{\hat{Y}}}\mathbf{W}_2^T
$$

再乘激活函数局部 Jacobian：
$$
\frac{\partial \mathcal{L}}{\partial \mathbf{Z}_1}
=
\frac{\partial \mathcal{L}}{\partial \mathbf{H}}
\odot
\phi'(\mathbf{Z}_1)
$$

最终一层参数梯度：
$$
\frac{\partial \mathcal{L}}{\partial \mathbf{W}_1}
=
\mathbf{X}^T
\frac{\partial \mathcal{L}}{\partial \mathbf{Z}_1}
$$

课堂重点：

1. 反向传播不是“从后往前拍脑袋传播误差”，而是局部 Jacobian 的严格链式连乘。
2. 框架在数值上实现的是局部 Jacobian 和上游梯度向量的乘积。
3. 这也是为什么显式构造 Hessian / 全 Jacobian 在深度网络里几乎不可行。

### 四、Autograd 动态图引擎的拓扑排序本质

PyTorch 的动态图在前向传播时即时构建：

1. 每个可导操作都生成一个 `Node`。
2. 每个 `Node` 保存局部反向函数与必要的中间缓存。
3. 节点之间通过 `next_functions` 串成一张有向无环图（DAG）。
4. 反向传播时，Autograd 按依赖顺序做逆拓扑遍历。

学生需要理解的不是“有个 `grad_fn` 属性”，而是：

1. `grad_fn` 对应的是 C++ 后端中的局部反向算子节点。
2. `AccumulateGrad` 是叶子参数的梯度累加器。
3. `AddmmBackward`、`ReluBackward`、`SigmoidBackward` 等节点是真实的算子图，不是教学示意图。

### 五、计算图的内存生死劫

这是本节课的硬核重点之一。

前向阶段：

1. 每执行一个可导操作，就会在堆内存中生成一个图节点。
2. 若某些反向计算需要中间激活，则这些张量会被保存为 `Saved Tensors`。

反向阶段：

1. 当 `loss.backward()` 执行完毕，默认这张图会被释放。
2. 中间激活缓存随之被清理，以回收显存。

因此需要学生明确：

1. 为什么把 `loss` 原样 append 到列表里会导致显存持续上涨：
   - 因为 `loss` 挂着整张图的引用，导致图无法销毁。
2. 为什么应写成 `loss.item()` 或 `float(loss.detach())`：
   - 因为这会切断图引用。
3. 为什么 `retain_graph=True` 危险：
   - 因为它强制保留图，若循环中反复使用将导致显存雪崩。

### 六、`.detach()` 与 `torch.no_grad()` 的底层差异

这两者表面都能“让张量不继续求导”，但位置不同：

`torch.no_grad()`：

1. 在源头关闭图构建。
2. 前向执行时根本不生成新的 Autograd 节点。
3. 因此额外图开销最小。

`.detach()`：

1. 原计算已经发生。
2. 图已经被构建出来。
3. 只是在当前张量上切断与既有图的反向连线。

课堂要求学生理解：

1. `no_grad` 更像“根本不立案”。
2. `detach` 更像“案子已经立了，但你从这条支路脱身了”。

### 七、激活函数的 Jacobian 退化：Sigmoid 与 ReLU 的病理学

`Sigmoid` 的导数：
$$
\sigma'(x)=\sigma(x)(1-\sigma(x))
$$

其最大值在 $x=0$ 处也仅有：
$$
\max \sigma'(x)=0.25
$$

因此在 $L$ 层网络中，若每层局部 Jacobian 的谱范数上界都被压到 0.25 左右，则反向传播的 Jacobian 连乘将近似满足：
$$
\left\|\prod_{\ell=1}^{L}\mathbf{J}_\ell\right\|_2
\le
(0.25)^L
$$

例如 10 层时：
$$
(0.25)^{10}\approx 9.5\times 10^{-7}
$$

这就是深层 Sigmoid 梯度消失的严格数量级解释。

`ReLU` 的导数：
$$
\phi'(x)=\mathbb{I}(x>0)
$$

它不会像 Sigmoid 那样持续收缩到 0.25 以下，但若某个神经元因为一次过大的参数更新，使得所有样本上都有：
$$
\mathbf{X}\mathbf{w}+b<0
$$

则该神经元对应 Jacobian 将永久为 0，陷入“死亡 ReLU”。

课堂要求学生用谱范数和局部 Jacobian 的角度解释：

1. 为什么 Sigmoid 是连乘衰减。
2. 为什么 ReLU 更像结构性拓扑断裂。
3. 为什么 GELU 往往在深层网络里更平滑、更稳定。

### 八、`nn.Module` 的元编程与参数注册黑魔法

`nn.Module` 的关键不只是封装，而是重写了 Python 的 `__setattr__`：

1. 若赋值对象是 `nn.Parameter`，则自动注册到参数字典。
2. 若赋值对象是另一个 `nn.Module`，则注册到子模块树。
3. 优化器、`state_dict()`、`.to(device)` 都依赖这套注册机制。

因此课堂必须明确：

1. 为什么把层放进普通 `list` 里会绕过注册雷达。
2. 为什么参数没注册时，代码表面能跑，但优化器根本找不到这些权重。
3. 为什么持久状态应放进 `register_buffer` 而不是普通成员变量。

## 实操

### 任务一：逆向工程 Autograd，编写 DAG 计算图可视化编译器

要求学生：

1. 构建一个三层 MLP 并得到 `loss`。
2. 编写递归函数 `walk_graph(loss.grad_fn)`。
3. 遍历所有 `next_functions`。
4. 使用 `networkx` 或 `Graphviz` 生成完整 DAG。

硬核要求：

1. 图中必须标识出：
   - `AccumulateGrad`
   - `AddmmBackward`
   - `ReluBackward`
   - 其他关键 C++ 算子节点
2. 必须能解释这张图为什么是 DAG 而不是普通树。

建议使用文件：

- `模块二_pytorch与深度学习训练闭环/代码示例/04_带Hook的MLP模型库_mlp_with_hooks.py`

### 任务二：做梯度病理学实验

要求学生：

1. 故意使用极不合理的初始化，例如：
   - `normal_(std=1.0)`
2. 构造一个 10 层 MLP。
3. 在不同激活函数下：
   - ReLU
   - Sigmoid
   - GELU
4. 使用 Forward Hook 和 Backward Hook 记录每层：
   - 激活均值
   - 激活方差
   - 梯度均值
   - 梯度方差
   - 梯度谱范数或近似谱范数

要求输出数值证据，直接观察：

1. Sigmoid 网络前层梯度如何向极小量塌缩。
2. 不合理初始化如何放大方差危机。

### 任务三：审讯计算图的内存生命周期

要求：

1. 故意写出：
   - `total_loss += loss`
   - `loss_list.append(loss)`
2. 观察显存或内存持续增长。
3. 用 `loss.item()`、`loss.detach()` 修复。
4. 再解释：
   - `retain_graph=True` 为什么危险
   - `torch.no_grad()` 与 `.detach()` 到底差在哪

### 任务四：纯肉眼代码审查演习

教师提供一段故意带毒代码，包含：

1. 层放在普通 `list`
2. 训练循环中直接累加 `loss`
3. 需要持久化的状态没有 `register_buffer`

要求学生：

1. 不运行代码，仅通过底层理解指出三个风险点。
2. 用 Vibe Coding 给出修复版。
3. 解释每个修复对应的底层机制。

## 验收标准

1. 必须提交一张由学生自己代码生成的 Autograd 计算图 DAG。
2. 必须能口头解释反向传播为什么本质上是 VJP，而不是全 Jacobian 计算。
3. 必须能在黑板上推导 Sigmoid 深层梯度衰减的数量级。
4. 必须提交一份梯度病理实验记录表，展示方差或谱范数随深度变化的证据。
5. 必须能解释 `loss.backward()` 之后图为什么默认会被释放。
6. 必须能区分 `.detach()`、`torch.no_grad()`、`retain_graph=True` 的作用边界。
7. 必须能指出至少一种参数注册缺失和一种图引用泄漏的隐性 Bug。

## 当堂交付物

1. 一张由学生代码生成的 Autograd DAG 图片。
2. 一份链式法则、VJP 与动态计算图推导笔记，至少包含：
   - 仿射映射与方差传播
   - 两层 MLP 梯度公式
   - Sigmoid Jacobian 连乘衰减证明
3. 一份梯度病理实验记录表。
4. 一份动态图内存生命周期与隐形 Bug 排查说明。
