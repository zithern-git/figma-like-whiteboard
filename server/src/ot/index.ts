/**
 * OT 模块统一导出
 *
 * 用法：
 *   import { otService, transform, compose, createLamportClock } from '../ot'
 *   import type { Operation, TransformResult } from '../ot'
 */

export * from './types'
export * from './LamportClock'
export { transform, transformChain, compose } from './transform'
export { otService } from './otService'
export type { ApplyResult } from './otService'
