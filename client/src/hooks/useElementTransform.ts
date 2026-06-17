/**
 * 元素变换 Hook (useElementTransform)
 *
 * 管理选中元素的变换操作，包括：
 * - 拖拽移动：选中元素后拖拽到新位置
 * - 缩放：拖拽 8 个控制手柄调整元素尺寸
 * - 旋转：拖拽旋转手柄以元素中心为轴旋转
 *
 * 变换类型：
 * 1. 移动（move）：拖拽元素主体，改变 x/y 坐标
 * 2. 缩放（scale）：拖拽包围盒手柄，改变 width/height
 * 3. 旋转（rotate）：拖拽旋转手柄，改变 rotation
 *
 * Shift 锁比例：缩放时按住 Shift 键保持宽高比不变。
 * 缩放和旋转仅对**单选**元素生效；多选只允许移动。
 */

import { useCallback, useRef } from "react";
import { CanvasRenderer, HitArea } from "@/canvas";
import { CanvasElement } from "@/canvas/CanvasElement";
import { useCanvasStore } from "@/stores/canvasStore";
import { deepClone } from "@/utils/Command";

/** 变换操作类型 */
type TransformType = "move" | "scale" | "rotate" | "none";

/** 8 个缩放手柄的位置标识 */
type ScaleHandle = "tl" | "tm" | "tr" | "ml" | "mr" | "bl" | "bm" | "br";

/** 元素最小尺寸（防止负值或过小） */
const MIN_SIZE = 5;

export function useElementTransform(renderer: CanvasRenderer | null) {
  const store = useCanvasStore();

  /** 当前变换类型 */
  const transformType = useRef<TransformType>("none");
  /** 变换起始世界坐标 */
  const transformStart = useRef({ x: 0, y: 0 });
  /** 当前激活的缩放手柄（仅 scale 模式有效） */
  const activeHandle = useRef<ScaleHandle | null>(null);
  /** 变换前元素的初始状态（用于撤销/相对计算） */
  const elementStatesBefore = useRef<Map<string, CanvasElement>>(new Map());
  /** 旋转开始时元素的初始旋转角度（弧度） */
  const initialRotation = useRef(0);
  /** 旋转开始时鼠标相对元素中心的极角（弧度） */
  const initialAngle = useRef(0);
  /** 是否正在变换 */
  const isTransforming = useRef(false);

  /**
   * 开始变换
   *
   * 通过 renderer.hitTest 判定当前点落在哪个区域（手柄/主体/无），
   * 据此决定 transformType；记录选中元素的初始状态和起始点。
   *
   * 关键修复（实时协作 / 拖动回放 bug）：不再调 beginUndoBatch。
   * 原因：之前的设计是"拖动期间每次 updateElement 都入栈，endBatch 合并为单次 undo"。
   * 但 updateElement 会广播 op → 拖动期间产生 N 个 update op 给 B
   * → B 端逐帧 apply，看到移动过程的"回放"，而不是最终位置。
   *
   * 新设计：拖动期间用 _updateElementLive（不广播不入栈），PointerUp 时
   * 计算 initial → final 的 diff，调一次 updateElement 提交最终值（入栈 + 广播）。
   *
   * @param e - 鼠标事件
   */
  const handleTransformStart = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!renderer) return;

      const state = useCanvasStore.getState();
      if (state.activeTool !== "select" || state.selectedIds.size === 0) return;

      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const worldPos = renderer.screenToWorld(screenX, screenY);

      // 命中检测：决定变换类型。仅在单选时检查手柄。
      const isOnlySelection = state.selectedIds.size === 1;
      let hit: HitArea = { type: "none" };
      if (isOnlySelection) {
        const id = Array.from(state.selectedIds)[0];
        const element = state.elements.find((el) => el.id === id);
        if (element) {
          hit = renderer.hitTest(element, worldPos.x, worldPos.y, true);
        }
      } else {
        // 关键修复：多选时遍历所有选中元素的 bbox，任一命中即视为 move
        for (const id of state.selectedIds) {
          const element = state.elements.find((el) => el.id === id);
          if (!element) continue;
          const h = renderer.hitTest(element, worldPos.x, worldPos.y, false);
          if (h.type === "move") {
            hit = h;
            break;
          }
        }
      }

      if (hit.type === "none") {
        isTransforming.current = false;
        transformType.current = "none";
        activeHandle.current = null;
        return;
      }

      transformStart.current = { ...worldPos };
      transformType.current = hit.type;
      activeHandle.current = hit.type === "scale" ? hit.handle : null;
      isTransforming.current = true;

      // 关键修复：记录所有选中元素的初始状态（不调 beginUndoBatch）
      // 拖动期间用 _updateElementLive 改 store，PointerUp 时用 diff 提交最终值
      elementStatesBefore.current = new Map();
      for (const id of state.selectedIds) {
        const element = state.elements.find((el) => el.id === id);
        if (element) {
          elementStatesBefore.current.set(id, deepClone(element));
        }
      }

      // 旋转：额外记录初始角度，用于计算角度增量
      if (hit.type === "rotate" && isOnlySelection) {
        const id = Array.from(state.selectedIds)[0];
        const element = state.elements.find((el) => el.id === id);
        if (element) {
          const bbox = renderer.getElementBBox(element);
          initialRotation.current = element.rotation || 0;
          initialAngle.current = Math.atan2(
            worldPos.y - bbox.cy,
            worldPos.x - bbox.cx
          );
        }
      }
    },
    [renderer]
  );

  /**
   * 执行变换
   *
   * 根据 transformType 分发到不同逻辑：
   * - move：所有选中元素同步平移（dx/dy）
   * - scale：根据手柄类型重算 x/y/width/height，Shift 锁比例
   * - rotate：以元素中心为轴，atan2 角度增量更新 rotation
   *
   * 关键修复（实时协作 / 拖动回放 bug）：
   * 拖动期间**只改本地 store，不广播 socket**。用 `_updateElementLive` 替代 `updateElement`：
   *   - `_updateElementLive` → 直接改 store（_replaceElementRaw），不入 undo 栈，不广播
   *   - 不会产生 50-100 个 op/秒 的 socket 流量
   *   - B 端不会看到"回放过程"，而是 PointerUp 时一次性看到最终位置
   *
   * PointerUp（handleTransformEnd）会计算 initial → final 的 diff，
   * 调一次 `updateElement` 提交最终值（入栈 + 广播）。
   *
   * @param e - 鼠标事件
   */
  const handleTransformMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!renderer || !isTransforming.current) return;

      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const worldPos = renderer.screenToWorld(screenX, screenY);

      const dx = worldPos.x - transformStart.current.x;
      const dy = worldPos.y - transformStart.current.y;
      const state = useCanvasStore.getState();

      if (transformType.current === "move") {
        // 移动：所有选中元素同步平移
        for (const id of state.selectedIds) {
          const initial = elementStatesBefore.current.get(id);
          if (initial) {
            const updates: Partial<CanvasElement> = {
              x: initial.x + dx,
              y: initial.y + dy,
            };
            // 关键修复：pen 和 line 的真实位置在 points 数组中（绝对坐标），
            // 只更新 x/y 不更新 points 会导致画笔/直线不移动
            if (
              (initial.type === "pen" || initial.type === "line") &&
              initial.points
            ) {
              updates.points = initial.points.map((p) => ({
                x: p.x + dx,
                y: p.y + dy,
              }));
            }
            // 关键修复（实时协作）：拖动期间用 _updateElementLive（不广播不入栈）
            state._updateElementLive(id, updates);
          }
        }
      } else if (transformType.current === "scale") {
        // 缩放：仅作用于单选元素
        if (state.selectedIds.size !== 1) return;
        const id = Array.from(state.selectedIds)[0];
        const initial = elementStatesBefore.current.get(id);
        if (!initial || !activeHandle.current) return;

        // 关键修复：把世界坐标反旋转到元素本地坐标系，与未旋转 bbox 配合计算
        const bbox = renderer.getElementBBox(initial);
        let lx = worldPos.x;
        let ly = worldPos.y;
        if (initial.rotation) {
          const cos = Math.cos(-initial.rotation);
          const sin = Math.sin(-initial.rotation);
          const dxc = worldPos.x - bbox.cx;
          const dyc = worldPos.y - bbox.cy;
          lx = bbox.cx + dxc * cos - dyc * sin;
          ly = bbox.cy + dxc * sin + dyc * cos;
        }

        // 第 1 步：根据手柄位置直接计算新 bbox
        const x = initial.x;
        const y = initial.y;
        const w = initial.width;
        const h = initial.height;
        const right = x + w;
        const bottom = y + h;
        const cx = x + w / 2;
        const cy = y + h / 2;
        const handle = activeHandle.current;

        let newX = x;
        let newY = y;
        let newW = w;
        let newH = h;
        switch (handle) {
          case "tl":
            newX = lx;
            newY = ly;
            newW = right - lx;
            newH = bottom - ly;
            break;
          case "tm":
            newY = ly;
            newH = bottom - ly;
            break;
          case "tr":
            newY = ly;
            newW = lx - x;
            newH = bottom - ly;
            break;
          case "ml":
            newX = lx;
            newW = right - lx;
            break;
          case "mr":
            newW = lx - x;
            break;
          case "bl":
            newX = lx;
            newW = right - lx;
            newH = ly - y;
            break;
          case "bm":
            newH = ly - y;
            break;
          case "br":
            newW = lx - x;
            newH = ly - y;
            break;
        }

        // 第 2 步：Shift 锁比例
        if (e.shiftKey && w > 0 && h > 0) {
          const aspect = w / h;
          const isCorner =
            handle === "tl" ||
            handle === "tr" ||
            handle === "bl" ||
            handle === "br";
          const isHorizontalEdge = handle === "ml" || handle === "mr";
          const isVerticalEdge = handle === "tm" || handle === "bm";

          if (isCorner) {
            // 角手柄：取 w/h 变化量中绝对值更大的作为统一缩放比
            const wRatio = Math.abs(newW) / w;
            const hRatio = Math.abs(newH) / h;
            const ratio = Math.max(wRatio, hRatio);
            newW = w * ratio;
            newH = h * ratio;
            // 让对角点保持不动
            if (handle === "tl") {
              newX = right - newW;
              newY = bottom - newH;
            } else if (handle === "tr") {
              newX = x;
              newY = bottom - newH;
            } else if (handle === "bl") {
              newX = right - newW;
              newY = y;
            } else {
              newX = x;
              newY = y;
            }
          } else if (isVerticalEdge) {
            // 上下边：宽度随高度按比例变化，中心 x 保持不动
            newW = Math.abs(newH) * aspect;
            newX = cx - newW / 2;
            if (handle === "tm") {
              newY = bottom - newH;
            }
          } else if (isHorizontalEdge) {
            // 左右边：高度随宽度按比例变化，中心 y 保持不动
            newH = Math.abs(newW) / aspect;
            newY = cy - newH / 2;
            if (handle === "ml") {
              newX = right - newW;
            }
          }
        }

        // 第 3 步：防止宽高过小或负值（翻转时调整锚点）
        if (newW < MIN_SIZE) {
          if (handle === "tl" || handle === "ml" || handle === "bl") {
            newX = right - MIN_SIZE;
          }
          newW = MIN_SIZE;
        }
        if (newH < MIN_SIZE) {
          if (handle === "tl" || handle === "tm" || handle === "tr") {
            newY = bottom - MIN_SIZE;
          }
          newH = MIN_SIZE;
        }

        // 直线/画笔的缩放：除了更新 x/y/width/height，还要等比缩放 points
        const updates: Partial<CanvasElement> = {
          x: newX,
          y: newY,
          width: newW,
          height: newH,
        };
        if (
          (initial.type === "line" || initial.type === "pen") &&
          initial.points &&
          w > 0 &&
          h > 0
        ) {
          // 关键修复：pen/line 缩放时按新 bbox 重新计算每个 point 的位置
          // 公式：new_point = (old_point - old_min) * (new_size / old_size) + new_min
          const oldMinX = Math.min(...initial.points.map((p) => p.x));
          const oldMinY = Math.min(...initial.points.map((p) => p.y));
          const oldMaxX = Math.max(...initial.points.map((p) => p.x));
          const oldMaxY = Math.max(...initial.points.map((p) => p.y));
          const oldW = oldMaxX - oldMinX || 1;
          const oldH = oldMaxY - oldMinY || 1;
          updates.points = initial.points.map((p) => ({
            x: newX + ((p.x - oldMinX) * newW) / oldW,
            y: newY + ((p.y - oldMinY) * newH) / oldH,
          }));
        }
        // 关键修复（实时协作）：拖动期间用 _updateElementLive（不广播不入栈）
        state._updateElementLive(id, updates);
      } else if (transformType.current === "rotate") {
        // 旋转：仅作用于单选元素
        if (state.selectedIds.size !== 1) return;
        const id = Array.from(state.selectedIds)[0];
        const initial = elementStatesBefore.current.get(id);
        if (!initial) return;

        // 使用初始元素 bbox 的中心（不会因为旋转而变化）
        const bbox = renderer.getElementBBox(initial);
        const currentAngle = Math.atan2(
          worldPos.y - bbox.cy,
          worldPos.x - bbox.cx
        );
        const deltaAngle = currentAngle - initialAngle.current;
        // 可选：Shift 锁定 15° 步进
        let newRotation = initialRotation.current + deltaAngle;
        if (e.shiftKey) {
          const STEP = Math.PI / 12; // 15°
          newRotation = Math.round(newRotation / STEP) * STEP;
        }
        // 关键修复（实时协作）：拖动期间用 _updateElementLive（不广播不入栈）
        state._updateElementLive(id, { rotation: newRotation });
      }
    },
    [renderer, store]
  );

  /**
   * 结束变换
   *
   * 关键修复（实时协作 / 拖动回放 bug）：
   * 拖动期间用 _updateElementLive 改了 store 但不入栈不广播。
   * PointerUp 时计算 initial → final 的 diff，调一次 updateElement 提交
   * 最终值（入栈 + 广播），让 B 端一次性看到最终位置。
   *
   * 不再调 endUndoBatch（之前的设计是"拖动期间每次 updateElement 都入栈，
   * 合并为单次 undo"——但 updateElement 会广播 op，导致 B 端看到回放）。
   * 新设计：拖动期间不入栈，PointerUp 时一次 updateElement 入栈一次 undo。
   */
  const handleTransformEnd = useCallback(
    (_e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isTransforming.current) {
        const state = useCanvasStore.getState();
        // 对每个被变换过的元素：计算 initial → current 的 diff，
        // 调一次 updateElement（入栈 + 广播最终值）
        for (const id of state.selectedIds) {
          const initial = elementStatesBefore.current.get(id);
          if (!initial) continue;
          const finalEl = state.elements.find((el) => el.id === id);
          if (!finalEl) continue;
          // 关键修复：判断是否有变化（只有真正改过的元素才提交）
          let hasChange = false;
          for (const k of Object.keys(finalEl) as (keyof typeof finalEl)[]) {
            if (k === "id" || k === "updatedAt") continue;
            if (
              JSON.stringify((finalEl as any)[k]) !==
              JSON.stringify((initial as any)[k])
            ) {
              hasChange = true;
              break;
            }
          }
          if (!hasChange) continue;
          // 计算 diff: final - initial
          const updates: Partial<CanvasElement> = {};
          for (const k of Object.keys(finalEl) as (keyof typeof finalEl)[]) {
            if (k === "id" || k === "updatedAt") continue;
            if (
              JSON.stringify((finalEl as any)[k]) !==
              JSON.stringify((initial as any)[k])
            ) {
              (updates as any)[k] = (finalEl as any)[k];
            }
          }
          // 关键修复：调一次 updateElement（入栈 + 广播最终值）
          // UpdateElementCommand 构造时 oldSnapshot=current（已经被 live 改成 final），
          // newSnapshot=current+updates（=final），但 broadcastFields 强制带上 updates 字段，
          // 所以 B 端能收到所有变化字段
          state.updateElement(id, updates);
        }
      }
      isTransforming.current = false;
      transformType.current = "none";
      activeHandle.current = null;
      elementStatesBefore.current.clear();
    },
    []
  );

  return {
    handleTransformStart,
    handleTransformMove,
    handleTransformEnd,
    isTransforming,
  };
}
