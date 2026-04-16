# TUI Filter Model

`codexs` 的 TUI filter 是一套 `session-global` 的结构化筛选状态，不是把所有东西塞进自由文本 query。

## 目标

- 让用户在同一个 TUI 会话里稳定切换搜索范围，而不是每次重输整串命令行参数。
- 把高注意力操作放在底部交互区，避免顶部 header 变成配置面板。
- 让 query 和 filter 是两个并列维度：
  - query 负责“搜什么”
  - filter 负责“在哪些线程里搜”

## 状态模型

`codexs` 当前维护的 filter state 是：

| 字段 | 作用 |
| --- | --- |
| `sourceMode` | `active` / `archived` / `all` |
| `range` | `1d` / `7d` / `30d` / `all-time` / `custom` |
| `recent` / `start` / `end` / `allTime` | 时间范围的具体表达 |
| `view` | `useful` / `ops` / `protocol` / `all` |
| `caseSensitive` | 大小写匹配模式 |

默认值是：

- `sourceMode = active`
- `range = 30d`
- `view = useful`
- `caseSensitive = false`

## 交互模型

### 入口

- `f`：在线程列表里打开 filter picker
- `Ctrl+f`：在底部搜索输入活跃时打开 filter picker

### 位置

- filter picker 是一个覆盖在 body 区域下方的底部 overlay
- query 输入 dock 仍然保留在状态栏上方
- footer/status bar 不直接承担 filter 编辑工作

### 结构

- picker 分为 `rows` 和 `values` 两层
- row 负责选“哪一类 filter”
- value 负责选“该 row 的值”

当前 row 顺序：

1. `Source`
2. `Range`
3. `View`
4. `Case`

### 行为

- filter 改动写回当前 TUI session 的全局状态
- 后续搜索、预览、刷新都沿用这套状态
- 关闭 picker 时，如果 filter 没变，不触发额外 re-search
- 如果 filter 有变化，则触发一次新的搜索/刷新

## 展示模型

`codexs` 会把 filter 摘要压缩成一行 summary，用在底部 query dock 和状态信息附近。

典型格式：

```text
active · recent 30d · useful · ignore case
```

这个 summary 的作用是：

- 让用户始终知道当前结果集的边界
- 避免把 filter 细节塞进 header
- 让底部搜索 dock 成为 query + scope 的统一入口

## 时间范围语义

`codexs` 的时间范围是搜索级别语义，不依赖文件系统 `mtime/ctime`。

- `recent 30d` 是默认窗口
- `all-time` 是显式逃生口
- `start/end` 用于精确日期区间
- 时间过滤既用于文件级预筛，也用于命中级时间判断

对 `codext` 的迁移启发是：

- 应优先按线程元数据时间字段做筛选
- 不应按 rollout JSONL 的 `mtime/ctime` 做主语义

## 对 `codext` 的可迁移最小子集

`codext` 不需要完整照搬 `codexs` 的 `source/view/case`。

最值得迁移的是：

1. `session-global filter state`
2. `f` 打开的底部 filter picker
3. filter summary 出现在底部 dock
4. `Range` 作为第一优先级 filter

对 `codext` 来说，首个最小可用子集可以只有：

| 字段 | 值 |
| --- | --- |
| `range` | `1d` / `7d` / `30d` / `all-time` |

文本 filter 继续保留，但和 range 叠加，而不是互相替代。
