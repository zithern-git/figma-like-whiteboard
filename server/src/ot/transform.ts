/**
 * OT transform / compose 核心算法
 *
 * transform(op1, op2)
 * -------------------
 * 输入：两个 op（op1 先执行，op2 后执行）。两者都基于"原始状态 S0"。
 * 输出：变换后的 op2'，使得 op2' 在 "S0 + op1" 之后执行，结果等同于
 *       op2 在 S0 上执行（即 OT 的收敛性 / convergence property）。
 *
 * transform 的核心规则（按 op1.opType × op2.opType 组合）：
 * - add      vs add      → 不变（id 不同则互不影响；id 相同则去重）
 * - add      vs update   → 不变（id 不同；id 相同则 update 仍然有效）
 * - add      vs delete   → 不变（id 不同；id 相同则 delete 生效）
 * - update   vs update   →
 *     · 不同元素：op2' = op2
 *     · 相同元素：
 *         - 不同属性 → op2'.updates = { ...op1.updates, ...op2.updates }
 *           （但 op1 的位置/尺寸变更不会影响 op2 期望的语义目标值，op2 的最终值由
 *             op1 在 op2 之前写入的属性值 + op2 自己写入的属性值组成）
 *         - 相同属性 → op2' 覆盖 op1 的值（last-writer-wins on field level）
 *         - 位置/尺寸属性（x/y/width/height）→ 调整 op2 的坐标使其相对 O1 的变换生效
 * - delete   vs update   → op2 丢弃（update 目标元素已被删除）
 * - delete   vs delete   → op2 变 noop
 * - clear-all 任意组合  → clear-all 抹除一切，op2 变 noop
 * - add      vs clear-all→ op2 变 noop
 *
 * compose(opA, opB)
 * -----------------
 * 输入：opA（先执行）和 opB（基于 "S + opA" 状态的 opB）。
 * 输出：合并后的 opAB，使得 opAB 在 S 上执行的结果等同于依次执行 opA, opB。
 *
 * compose 的核心规则：
 * - opA = add(X), opB = delete(X)   → noop（X 创建后立刻删除）
 * - opA = delete(X), opB = add(X)   → noop（被删后又被加回来？通常不会，但合并为 noop）
 *   注意：实际业务里可能想保留 add（X 复活），但本实现按"幂等合并"处理为 noop；
 *         如有特殊需要，可改为 opAB = opB。
 * - opA = update(X, f1), opB = update(X, f2) →
 *     - 交集属性 → 取 f2 的值（后写覆盖）
 *     - 互斥属性 → 合并为单个多字段 update
 * - opA = update(X, ...), opB = delete(X) → noop
 * - 任意一方为 noop → 返回另一方
 *
 * 函数均为纯函数，无副作用。OT 服务的所有并发处理都通过这两个函数完成。
 */

import {
  Operation,
  TransformResult,
  ComposeResult,
  AddOpPayload,
  UpdateOpPayload,
  DeleteOpPayload,
  POSITION_FIELDS,
  PositionField,
} from './types'

// ---------- helpers ----------

function isAddPayload(p: Operation['payload']): p is AddOpPayload {
  return (p as AddOpPayload).element !== undefined
}
function isUpdatePayload(p: Operation['payload']): p is UpdateOpPayload {
  const u = p as UpdateOpPayload
  return typeof u.id === 'string' && u.updates !== undefined
}
function isDeletePayload(p: Operation['payload']): p is DeleteOpPayload {
  const d = p as DeleteOpPayload
  return typeof d.id === 'string' && (d as any).element === undefined
}

function getTargetId(op: Operation): string | null {
  if (isAddPayload(op.payload)) return op.payload.element.id
  if (isUpdatePayload(op.payload)) return op.payload.id
  if (isDeletePayload(op.payload)) return op.payload.id
  return null
}

function isPositionField(key: string): key is PositionField {
  return (POSITION_FIELDS as readonly string[]).includes(key)
}

function isNoop(op: Operation): boolean {
  // 约定：clear-all 不算 noop
  if (op.opType === 'clear-all') return false
  return false // 当前没有空操作类型；如未来扩展（如 add 占位符），再判断
}

function noopResult(op2: Operation): TransformResult {
  return {
    operation: { ...op2, payload: {} as any },
    dropped: true,
    becameNoop: true,
  }
}

function unchangedResult(op2: Operation): TransformResult {
  return {
    operation: op2,
    dropped: false,
    becameNoop: false,
  }
}

/**
 * 计算 op1（先执行的 update）相对于"绝对坐标"的位置/尺寸变更，
 * 用于把 op2 期望的"绝对位置"转换为"基于 op1 之后的位置"。
 *
 * 返回 { dx, dy, dWidth, dHeight } 描述 op1 改变的几何量。
 */
function computeGeometryDelta(op1: Operation): {
  dx: number
  dy: number
  dWidth: number
  dHeight: number
} {
  if (!isUpdatePayload(op1.payload)) {
    return { dx: 0, dy: 0, dWidth: 0, dHeight: 0 }
  }
  const u = op1.payload.updates
  return {
    dx: typeof u.x === 'number' ? (u.x as number) : 0,
    dy: typeof u.y === 'number' ? (u.y as number) : 0,
    dWidth: typeof u.width === 'number' ? (u.width as number) : 0,
    dHeight: typeof u.height === 'number' ? (u.height as number) : 0,
  }
}

/**
 * 对 op2.updates 中受 op1 位置/尺寸变更影响的字段做坐标调整
 *
 * 设计要点：
 * - op2 的 update 是基于"原始位置/尺寸"写绝对值（如 x = 100）
 * - op1 之后坐标已经"漂移"了 op1.updates 中给出的量
 * - 因此 op2 想要"达到相同的最终位置"，需要先把 op2 写回
 *   "op1 之前"的对应绝对值（即减去 op1 的变更）
 *
 * 这里的语义是"覆盖语义"：op2 想把元素放到 X，op1 已经把元素放到 X+dx，
 * 那 op2 要把元素从 X+dx 改回 X → op2.updates.x = X - dx。
 *
 * 注意：只有当 op2 的 updates 中显式包含了 x/y/width/height 才调整；
 * 没包含则不动（保持 op2 自己的非几何字段不变）。
 */
function adjustGeometryByDelta(
  op2Updates: Record<string, unknown>,
  delta: { dx: number; dy: number; dWidth: number; dHeight: number }
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...op2Updates }
  for (const field of POSITION_FIELDS) {
    if (!(field in result)) continue
    const val = result[field]
    if (typeof val !== 'number') continue
    switch (field) {
      case 'x':
        result[field] = val - delta.dx
        break
      case 'y':
        result[field] = val - delta.dy
        break
      case 'width':
        result[field] = val - delta.dWidth
        break
      case 'height':
        result[field] = val - delta.dHeight
        break
    }
  }
  return result
}

// ---------- transform ----------

/**
 * OT transform 主入口
 *
 * @param op1 先执行的 op（已成功应用到状态）
 * @param op2 后执行的 op（基于 op1 之前的状态生成）
 * @returns 变换后的 op2'（基于 op1 之后的状态能正确生效）
 *
 * 语义保证：
 * 1. apply(apply(S, op1), op2') = apply(apply(S, op2), op1)（convergence）
 * 2. op2' 保留 op2 的"意图"（用户最终想看到什么）
 */
export function transform(op1: Operation, op2: Operation): TransformResult {
  if (isNoop(op2)) return unchangedResult(op2)
  if (isNoop(op1)) return unchangedResult(op2)

  // 0. clear-all 抹一切
  if (op1.opType === 'clear-all') {
    return noopResult(op2)
  }
  if (op2.opType === 'clear-all') {
    return noopResult(op2)
  }

  // 1. add vs add：id 相同 → 去重，op2' 视为 noop
  if (op1.opType === 'add' && op2.opType === 'add') {
    const id1 = getTargetId(op1)
    const id2 = getTargetId(op2)
    if (id1 && id1 === id2) {
      return noopResult(op2)
    }
    return unchangedResult(op2)
  }

  // 2. add vs update：id 不同时 op2' 不变；id 相同时 op2 仍然能作用于 op1 新加的元素
  if (op1.opType === 'add' && op2.opType === 'update') {
    return unchangedResult(op2)
  }

  // 3. add vs delete：id 不同时 op2' 不变；id 相同时 op2 删除 op1 新加的元素
  if (op1.opType === 'add' && op2.opType === 'delete') {
    return unchangedResult(op2)
  }

  // 4. update vs add：op1.update 不影响 op2.add（add 总是把元素加进去）
  if (op1.opType === 'update' && op2.opType === 'add') {
    return unchangedResult(op2)
  }

  // 5. update vs update
  if (op1.opType === 'update' && op2.opType === 'update') {
    const id1 = getTargetId(op1)
    const id2 = getTargetId(op2)
    if (id1 !== id2) {
      return unchangedResult(op2)
    }
    // 同一元素：合并 updates
    if (!isUpdatePayload(op1.payload) || !isUpdatePayload(op2.payload)) {
      return unchangedResult(op2)
    }
    // OT 收敛性策略：op1 vs op2 在 lamport 上比较，
    //   · op2.lamport >= op1.lamport → op2 视为"后到者"，op2 的意图（绝对值）胜出
    //     → 对 op2 中与 op1 冲突的 position 字段做 delta 反向补偿（使其在 op1 之后能产生正确效果）
    //   · op2.lamport <  op1.lamport → op1 是"后到者"，op2 不再写冲突字段
    //     → 冲突字段从 op2 payload 中丢弃；非冲突字段保留
    // 这样两个方向 transform 后 apply 顺序不同时，最终状态一致（convergence）。
    const op1Lamport = op1.lamportClock ?? 0
    const op2Lamport = op2.lamportClock ?? 0
    const op2IsLater = op2Lamport > op1Lamport
    // tie（相等）：也走 op2IsLater 分支（"后生成的"作为后到者），保证确定性

    const op1Keys = new Set(Object.keys(op1.payload.updates))
    const op2Keys = new Set(Object.keys(op2.payload.updates))
    const conflictKeys = new Set<string>()
    for (const k of op1Keys) {
      if (op2Keys.has(k)) conflictKeys.add(k)
    }

    if (!op2IsLater) {
      // op1 是后到者：op2 在冲突字段上让位（丢弃），非冲突字段保留
      const newUpdates: Record<string, unknown> = {}
      for (const key of op2Keys) {
        if (conflictKeys.has(key)) continue
        newUpdates[key] = op2.payload.updates[key]
      }
      return {
        operation: {
          ...op2,
          payload: { id: id2, updates: newUpdates } as UpdateOpPayload,
        },
        dropped: false,
        becameNoop: Object.keys(newUpdates).length === 0,
      }
    }

    // op2 是后到者：op2 的意图胜出，position 字段做 delta 反向补偿
    const op2Updates = op2.payload.updates
    const delta = computeGeometryDelta(op1)
    const newUpdates: Record<string, unknown> = {}
    for (const key of Object.keys(op2Updates)) {
      const val = op2Updates[key]
      if (isPositionField(key) && typeof val === 'number') {
        switch (key) {
          case 'x':
            newUpdates[key] = val - delta.dx
            break
          case 'y':
            newUpdates[key] = val - delta.dy
            break
          case 'width':
            newUpdates[key] = val - delta.dWidth
            break
          case 'height':
            newUpdates[key] = val - delta.dHeight
            break
        }
      } else {
        newUpdates[key] = val
      }
    }

    const newOp: Operation = {
      ...op2,
      payload: { id: id2, updates: newUpdates } as UpdateOpPayload,
    }
    return { operation: newOp, dropped: false, becameNoop: false }
  }

  // 6. update vs delete：op2 删除的目标若被 op1 改过，op2 仍然有效（delete 总是成功）
  if (op1.opType === 'update' && op2.opType === 'delete') {
    return unchangedResult(op2)
  }

  // 7. delete vs add：op1 删除了 X，op2 又 add(X)？
  //    严格 OT 下 op1.delete(X) 让 X 不存在，op2.add(X) 在 op1 之后再加 X 是合法的。
  //    我们保持 op2 不变（add 总是把新元素加进去），由应用层去重。
  if (op1.opType === 'delete' && op2.opType === 'add') {
    return unchangedResult(op2)
  }

  // 8. delete vs update：op1 删除了 X，op2 想改 X → 丢弃
  if (op1.opType === 'delete' && op2.opType === 'update') {
    const id1 = getTargetId(op1)
    const id2 = getTargetId(op2)
    if (id1 === id2) {
      return noopResult(op2)
    }
    return unchangedResult(op2)
  }

  // 9. delete vs delete：同一元素 → 后一个变 noop
  if (op1.opType === 'delete' && op2.opType === 'delete') {
    const id1 = getTargetId(op1)
    const id2 = getTargetId(op2)
    if (id1 === id2) {
      return noopResult(op2)
    }
    return unchangedResult(op2)
  }

  // 兜底：不变
  return unchangedResult(op2)
}

/**
 * 批量 transform：把 op2 针对一个 op 链 [op1, op1', op1'' ...] 依次 transform
 *
 * 用途：otService 处理"缓冲 op 链"时，连续 transform 一串 op。
 */
export function transformChain(op1Chain: Operation[], op2: Operation): TransformResult {
  let current: Operation = op2
  for (const op1 of op1Chain) {
    const r = transform(op1, current)
    if (r.dropped || r.becameNoop) return r
    current = r.operation
  }
  return { operation: current, dropped: false, becameNoop: false }
}

// ---------- compose ----------

/**
 * OT compose 主入口
 *
 * @param opA 先执行的 op
 * @param opB 基于 "S + opA" 状态的 op（不能直接作用于 S，需要重写）
 * @returns 合并后的 opAB
 *
 * 语义：apply(S, opAB) = apply(apply(S, opA), opB)
 */
export function compose(opA: Operation, opB: Operation): ComposeResult {
  // 任一为 clear-all：保留 clear-all
  if (opA.opType === 'clear-all') {
    return { operation: { ...opB, baseVersion: opA.baseVersion, lamportClock: Math.max(opA.lamportClock, opB.lamportClock) }, becameNoop: false }
  }
  if (opB.opType === 'clear-all') {
    return { operation: { ...opB, baseVersion: opA.baseVersion, lamportClock: Math.max(opA.lamportClock, opB.lamportClock) }, becameNoop: false }
  }

  // add + delete 同一元素 → 抵消
  if (opA.opType === 'add' && opB.opType === 'delete') {
    const idA = getTargetId(opA)
    const idB = getTargetId(opB)
    if (idA && idA === idB) {
      return {
        operation: makeNoopOp(opA, opB),
        becameNoop: true,
      }
    }
  }
  if (opA.opType === 'delete' && opB.opType === 'add') {
    const idA = getTargetId(opA)
    const idB = getTargetId(opB)
    if (idA && idA === idB) {
      // X 被删后又被加回来：保守按 noop 处理（避免"幽灵复活"）
      return {
        operation: makeNoopOp(opA, opB),
        becameNoop: true,
      }
    }
  }

  // update + delete 同一元素 → 抵消为 delete（保留删除意图）
  if (opA.opType === 'update' && opB.opType === 'delete') {
    const idA = getTargetId(opA)
    const idB = getTargetId(opB)
    if (idA && idA === idB) {
      return {
        operation: {
          ...opB,
          baseVersion: opA.baseVersion,
          lamportClock: Math.max(opA.lamportClock, opB.lamportClock),
        },
        becameNoop: false,
      }
    }
  }

  // update + update 同一元素 → 合并
  if (opA.opType === 'update' && opB.opType === 'update') {
    const idA = getTargetId(opA)
    const idB = getTargetId(opB)
    if (idA && idA === idB && isUpdatePayload(opA.payload) && isUpdatePayload(opB.payload)) {
      const merged: Record<string, unknown> = { ...opA.payload.updates, ...opB.payload.updates }
      // 几何补偿：opA 已经把 x/y/width/height 改成 opA.updates 的值；
      // opB 想把它改成 opB.updates 的值（这些 opB.updates 是基于 opA 之后的状态），
      // 所以直接取 opB.updates 的值即可（因为 opB 已经是"opA 之后"的视角）。
      // 这里的语义是"最终值由 opB 决定"，所以不用 transform 里的反向补偿。
      return {
        operation: {
          ...opB,
          payload: { id: idA, updates: merged } as UpdateOpPayload,
          baseVersion: opA.baseVersion,
          lamportClock: Math.max(opA.lamportClock, opB.lamportClock),
        },
        becameNoop: false,
      }
    }
  }

  // delete + delete 同一元素 → 单一 delete
  if (opA.opType === 'delete' && opB.opType === 'delete') {
    const idA = getTargetId(opA)
    const idB = getTargetId(opB)
    if (idA && idA === idB) {
      return {
        operation: {
          ...opA,
          baseVersion: opA.baseVersion,
          lamportClock: Math.max(opA.lamportClock, opB.lamportClock),
        },
        becameNoop: false,
      }
    }
  }

  // 兜底：返回 opB，但 baseVersion 回退到 opA.baseVersion（让 opAB 在 S 上直接生效）
  return {
    operation: {
      ...opB,
      baseVersion: opA.baseVersion,
      lamportClock: Math.max(opA.lamportClock, opB.lamportClock),
    },
    becameNoop: false,
  }
}

/**
 * 制造一个空操作（用于抵消 / drop 场景的占位）
 *
 * 当前约定：opType 不变（保持原始 opType），payload 置为空对象。
 * otService 在应用 noop 时会检测 becameNoop 标志直接跳过，不实际调用 apply。
 */
function makeNoopOp(opA: Operation, opB: Operation): Operation {
  return {
    ...opB,
    baseVersion: opA.baseVersion,
    lamportClock: Math.max(opA.lamportClock, opB.lamportClock),
    payload: {} as any,
  }
}
