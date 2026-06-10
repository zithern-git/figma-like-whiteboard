# 撤销/重做系统重构设计

**日期**: 2026-06-10
**阶段**: Phase 5 — Task 10 / Task 11
**状态**: 设计已批准，待实施

## Why

`canvasStore.ts` 当前内联了 Command 接口与 undo/redo 栈逻辑，与规范要求的"utils/Command.ts 基类 + utils/UndoManager.ts 独立 Manager"不符。`Task 10` 还要求 batchId 操作合并与 50 步栈容量限制，目前均未实现。本次工作把这部分提取到独立模块并补齐缺失特性，同时保持现有 store 公开 API（`selectedIds: Set<string>`、`viewport: { translateX, translateY, zoom }`）不变，最小化对调用方影响。

## What Changes

- 新建 `client/src/utils/Command.ts`：Command 接口 + 4 个具体命令类（Add/Delete/Update/ClearAll）+ 内部 BatchCommand
- 新建 `client/src/utils/UndoManager.ts`：独立管理器，封装 undoStack/redoStack/batch 状态机
- 重构 `client/src/stores/canvasStore.ts`：所有元素变更委托给 UndoManager；新增 `beginUndoBatch` / `endUndoBatch` / `canUndo` / `canRedo`；暴露 `_raw` 内部方法供 Command 重放使用
- 修改 `client/src/hooks/useElementTransform.ts`：在 `pointerdown`/`pointerup` 包裹 batch
- 修改 `client/src/hooks/useDrawTool.ts`：在 `drawStart`/`drawEnd` 包裹 batch
- 修改 `client/src/hooks/useKeyboardShortcuts.ts`：注册 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
- **不修改**：`selectedIds` 类型、viewport 字段名、WhiteboardPage 整体结构、协作相关代码

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Interaction Layer                                           │
│  useElementTransform (拖拽/缩放/旋转)  → beginBatch/endBatch │
│  useDrawTool (绘制)                   → beginBatch/endBatch │
│  PropertiesPanel (属性面板)            → 不 batch (单步)     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  canvasStore (Zustand)                                       │
│  addElement / updateElement / deleteElement / clearAll        │
│  → 创建 Command 对象 → UndoManager.execute(cmd)               │
│  内部 _raw 方法绕过 UndoManager（供 undo/redo 重放）          │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  utils/Command.ts        utils/UndoManager.ts                │
│  Command 接口            stack 容量 50                       │
│  AddElementCommand       beginBatch / endBatch                │
│  DeleteElementCommand    undo / redo                          │
│  UpdateElementCommand    execute (清空 redoStack)              │
│  ClearAllElementsCommand                                     │
│  BatchCommand (内部)                                         │
└─────────────────────────────────────────────────────────────┘
```

## File-Level Design

### `client/src/utils/Command.ts`（新建）

```typescript
export interface Command {
  readonly type: 'add' | 'delete' | 'update' | 'clear-all' | 'batch'
  /** 非空时表示该命令属于某个 batch，同 batchId 会被合并为一步 undo */
  batchId?: string
  execute(): void
  undo(): void
}

/** CanvasElement 完整深拷贝（包含可选 points 数组） */
export type ElementSnapshot = CanvasElement

/**
 * 命令所需的"低层 store 能力"接口，由 canvasStore 自身实现。
 * 命令对象只调用这些方法，不依赖整个 Zustand store 形状。
 */
export interface CommandStore {
  _getElementRaw(id: string): CanvasElement | undefined
  _addElementRaw(element: CanvasElement): void
  _removeElementRaw(id: string): void
  _replaceElementRaw(element: CanvasElement): void
  _setElementsRaw(elements: CanvasElement[]): void
}

export class AddElementCommand implements Command { ... }
export class DeleteElementCommand implements Command { ... }
export class UpdateElementCommand implements Command {
  // 关键：构造时深拷贝旧元素快照，undo 时恢复
  private oldSnapshot: ElementSnapshot
  private newSnapshot: ElementSnapshot
  ...
}
export class ClearAllElementsCommand implements Command { ... }

/** 内部：将多个命令封装为单条栈记录，undo 时按逆序回放 */
class BatchCommand implements Command {
  constructor(public readonly batchId: string, private cmds: Command[]) {}
  execute() { this.cmds.forEach(c => c.execute()) }
  undo() { [...this.cmds].reverse().forEach(c => c.undo()) }
}
```

### `client/src/utils/UndoManager.ts`（新建）

```typescript
const MAX_STACK_SIZE = 50

export class UndoManager {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private currentBatchId: string | null = null
  private currentBatchCmds: Command[] = []
  /** 任何栈变更都通知 store 同步引用，触发 React 订阅 */
  private onChange: () => void

  constructor(onChange: () => void) { this.onChange = onChange }

  /** execute 决策树：
   *  - cmd.batchId === currentBatchId     → 累加到 currentBatchCmds
   *  - cmd.batchId 是新值（非空）        → finalize 旧 batch，开新 batch
   *  - cmd.batchId 为空                   → finalize 旧 batch，单独压栈
   */
  execute(cmd: Command): void { ... }

  beginBatch(batchId: string): void {
    this.finalizeBatch()
    this.currentBatchId = batchId
    this.currentBatchCmds = []
  }

  endBatch(): void { this.finalizeBatch() }

  undo(): void { ... }
  redo(): void { ... }

  /** 查询接口（替代内联栈引用） */
  canUndo(): boolean { return this.undoStack.length > 0 }
  canRedo(): boolean { return this.redoStack.length > 0 }

  private finalizeBatch(): void {
    if (this.currentBatchId && this.currentBatchCmds.length > 0) {
      this.push(new BatchCommand(this.currentBatchId, this.currentBatchCmds))
    }
    this.currentBatchId = null
    this.currentBatchCmds = []
  }

  private push(cmd: Command): void {
    this.undoStack.push(cmd)
    if (this.undoStack.length > MAX_STACK_SIZE) this.undoStack.shift()
  }
}
```

### `canvasStore.ts` 集成

```typescript
// 内部 UndoManager 实例
const undoManager = new UndoManager(() => {
  // 通知 React 订阅者（同步栈引用）
  set({
    undoStack: undoManager['undoStack'] as any,  // 简化：暴露 readonly 视图
    redoStack: undoManager['redoStack'] as any,
  })
})

// 公开 action 改为创建 Command 委托给 manager
addElement: (element) => undoManager.execute(new AddElementCommand(store, element))
updateElement: (id, updates) => undoManager.execute(new UpdateElementCommand(store, id, updates))
deleteElement: (id) => {
  const el = get().elements.find(e => e.id === id)
  if (el) undoManager.execute(new DeleteElementCommand(store, el))
}
clearAllElements: () => undoManager.execute(new ClearAllElementsCommand(store, get().elements))

// 新增 batch 入口
beginUndoBatch: (id) => undoManager.beginBatch(id)
endUndoBatch: () => undoManager.endBatch()

// 新增查询（用于工具栏按钮 disabled 状态）
canUndo: () => undoManager.canUndo()
canRedo: () => undoManager.canRedo()

// 内部 _raw（命令重放入口，绕过 UndoManager）
_getElementRaw: (id) => get().elements.find(e => e.id === id)
_addElementRaw: (el) => set(s => ({ elements: [...s.elements, el] }))
_removeElementRaw: (id) => set(s => ({ elements: s.elements.filter(e => e.id !== id) }))
_replaceElementRaw: (el) => set(s => ({
  elements: s.elements.map(e => e.id === el.id ? el : e)
}))
_setElementsRaw: (els) => set({ elements: els })
```

### 交互层 batch 包裹

```typescript
// useElementTransform.ts
const startTransform = (target) => {
  beginUndoBatch(`transform-${target.id}`)
  // ... 开始拖拽
}
const endTransform = () => {
  endUndoBatch()
  // ... 结束
}

// useDrawTool.ts
const drawStart = () => beginUndoBatch(`draw-${nanoid(6)}`)
const drawEnd = () => endUndoBatch()
```

## Edge Cases

| 场景 | 处理 |
|---|---|
| 在 batch 中抛出异常 | `endBatch` 时 try/catch，已执行命令不撤销 |
| redo 时遇到已删除元素 | `UpdateElementCommand.undo` 检查元素是否存在，不存在则跳过 |
| 栈容量超限 | shift 最早的命令 |
| 同一 batchId 重复使用 | OK，append 到当前 batch |
| endBatch 时无命令 | 不压栈（避免空 undo 步骤） |
| selectedIds 撤销 | **不**回滚 selectedIds（撤销只影响 elements，符合 Figma 习惯） |
| 撤销后画新元素 | redoStack 已在 execute 中清空 |

## 手动测试场景

1. 画矩形 → Ctrl+Z 消失；Ctrl+Y 回来
2. 拖拽矩形 → Ctrl+Z 一步回到原位
3. 缩放矩形 → Ctrl+Z 一步恢复
4. 旋转矩形 → Ctrl+Z 一步恢复
5. Ctrl+D 复制 → Ctrl+Z 副本消失
6. 属性面板连续调 5 次 → 5 次 Ctrl+Z 回到初始（不 batch）
7. 撤销后画新元素 → redo 栈被清空
8. 栈超过 50 步 → 最早历史丢失

## YAGNI（不做的事）

- ❌ 协作 / Socket.IO
- ❌ 持久化 / 快照 / 增量恢复
- ❌ selectedIds 类型变更
- ❌ viewport 字段名变更
- ❌ 第三方 undo 库
- ❌ 自动化单元测试（手动测试覆盖）

## File Manifest

| 操作 | 路径 | 行数估计 |
|---|---|---|
| 新建 | `client/src/utils/Command.ts` | ~150 |
| 新建 | `client/src/utils/UndoManager.ts` | ~120 |
| 修改 | `client/src/stores/canvasStore.ts` | +60 / -80 |
| 修改 | `client/src/hooks/useElementTransform.ts` | +6 / -2 |
| 修改 | `client/src/hooks/useDrawTool.ts` | +4 / -2 |
| 修改 | `client/src/hooks/useKeyboardShortcuts.ts` | +10 / -2 |
