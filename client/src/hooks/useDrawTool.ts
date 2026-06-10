/**
 * 绘图工具 Hook (useDrawTool)
 *
 * 只处理鼠标事件和元素创建，不直接操作 Canvas 上下文。
 * 所有预览绘制通过 CanvasRenderer.addTemporaryDraw() 注册到统一渲染队列。
 *
 * 文本编辑采用 Figma 标准的交互逻辑：
 * - 统一的生命周期管理，cleanupTextEditor 作为唯一退出入口
 * - activeInputRef 确保任何时候最多只有一个编辑框
 * - 全局 click/keydown 监听实现点击外部自动保存和 Esc 取消
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { CanvasRenderer } from "@/canvas/CanvasRenderer";
import { CanvasElement, Point, ToolType } from "@/canvas/CanvasElement";
import { useCanvasStore } from "@/stores/canvasStore";

const ERASER_RADIUS = 16;
const MIN_SIZE = 2;

/** 临时绘制项的唯一 ID */
const TEMP_DRAW_ID = "draw-tool-preview";

/**
 * 编辑框上下文信息
 */
interface EditingContext {
  element: CanvasElement | null;
  elementIndex: number;
  originalText: string;
  worldX: number;
  worldY: number;
  screenX: number;
  screenY: number;
}

export function useDrawTool(_renderer: CanvasRenderer | null) {
  const store = useCanvasStore();

  const isDrawing = useRef(false);
  const activeTool = useRef<ToolType>("select");
  const startPt = useRef<Point>({ x: 0, y: 0 });
  const curPt = useRef<Point>({ x: 0, y: 0 });
  const penPts = useRef<Point[]>([]);

  /** 存储从事件中获取的 renderer 引用 */
  const rendererRef = useRef<CanvasRenderer | null>(null);

  // ========== 文本编辑状态管理（React state，不是全局变量） ==========
  const [isEditingText, setIsEditingText] = useState(false);
  const activeInputRef = useRef<HTMLTextAreaElement | null>(null);
  const editingContextRef = useRef<EditingContext | null>(null);

  // ========== 统一的编辑框清理函数 ==========
  const cleanupTextEditor = useCallback(
    (saveChanges: boolean = true) => {
      if (activeInputRef.current) {
        const input = activeInputRef.current;
        const context = editingContextRef.current;

        if (saveChanges && context) {
          const newText = input.value;
          if (newText || context.element) {
            if (context.element) {
              // 编辑现有文本
              store.updateElement(context.element.id, { text: newText });
            } else {
              // 创建新文本
              const el = store.createElement("text", {
                x: context.worldX,
                y: context.worldY,
                text: newText,
                width: 200,
                height: (store.fontSize || 16) * 2,
                fontSize: store.fontSize || 16,
              });
              store.addElement(el);
            }
          }
        } else if (!saveChanges && context && context.element) {
          // 取消编辑：恢复原文本
          store.updateElement(context.element.id, {
            text: context.originalText,
          });
        }

        document.body.removeChild(input);
        activeInputRef.current = null;
        editingContextRef.current = null;
        setIsEditingText(false);

        // 通知 CanvasRenderer 恢复渲染该文本
        if (context?.element) {
          rendererRef.current?.setEditingTextId(null);
        }
      }
    },
    [store]
  );

  // ========== 全局监听：点击编辑框外部自动保存 ==========
  useEffect(() => {
    const handleGlobalMouseDown = (e: MouseEvent) => {
      if (isEditingText && activeInputRef.current) {
        if (!activeInputRef.current.contains(e.target as Node)) {
          cleanupTextEditor(true);
        }
      }
    };

    window.addEventListener("mousedown", handleGlobalMouseDown, true);
    return () =>
      window.removeEventListener("mousedown", handleGlobalMouseDown, true);
  }, [isEditingText, cleanupTextEditor]);

  // ========== 全局监听：Esc 取消编辑 ==========
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (isEditingText) {
        e.stopPropagation();
        if (e.key === "Escape") {
          cleanupTextEditor(false);
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () =>
      window.removeEventListener("keydown", handleGlobalKeyDown, true);
  }, [isEditingText, cleanupTextEditor]);

  // ========== 统一创建文本编辑框 ==========
  const createTextEditor = useCallback(
    (
      screenX: number,
      screenY: number,
      worldX: number,
      worldY: number,
      initialText: string = "",
      existingElement: CanvasElement | null = null,
      elementIndex: number = -1
    ) => {
      // 如果已经有编辑框，先清理
      cleanupTextEditor(false);

      setIsEditingText(true);

      editingContextRef.current = {
        element: existingElement,
        elementIndex,
        originalText: initialText,
        worldX,
        worldY,
        screenX,
        screenY,
      };

      // 通知 CanvasRenderer 跳过渲染正在编辑的文本，使旧文本立即消失
      if (existingElement) {
        rendererRef.current?.setEditingTextId(existingElement.id);
      }

      const input = document.createElement("textarea");
      activeInputRef.current = input;

      // Figma 风格的编辑框样式
      input.style.position = "absolute";
      input.style.left = `${screenX}px`;
      input.style.top = `${screenY}px`;
      input.style.fontSize = existingElement?.fontSize
        ? `${existingElement.fontSize}px`
        : "16px";
      input.style.fontFamily =
        existingElement?.fontFamily || "Arial, sans-serif";
      input.style.color = existingElement?.fill || "#000000";
      input.style.border = "1px solid #1890ff";
      input.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.15)";
      input.style.outline = "none";
      input.style.background = "white";
      input.style.padding = "4px 6px";
      input.style.zIndex = "9999";
      input.style.resize = "none";
      input.style.overflow = "hidden";
      input.style.minWidth = "50px";
      input.style.minHeight = "24px";
      input.style.lineHeight = "1.2";
      input.style.whiteSpace = "pre";
      input.style.wordBreak = "keep-all";

      input.value = initialText;
      input.placeholder = "";

      // 自动调整输入框大小
      const autoResize = () => {
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight}px`;
        input.style.width = "auto";
        input.style.width = `${Math.max(input.scrollWidth, 50)}px`;
      };

      input.addEventListener("input", autoResize);

      // 输入框内部事件全部阻止冒泡
      input.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        // e.preventDefault()
      });
      input.addEventListener("mouseup", (e) => {
        e.stopPropagation();
      });
      input.addEventListener("click", (e) => {
        e.stopPropagation();
      });
      input.addEventListener("dblclick", (e) => {
        e.stopPropagation();
      });

      // Enter 保存，Shift+Enter 换行
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          cleanupTextEditor(true);
        }
      });

      document.body.appendChild(input);
      input.focus();
      input.select();
      autoResize();
    },
    [cleanupTextEditor]
  );

  // ========== 双击编辑文本的入口方法（供 WhiteboardPage 调用） ==========
  const handleDoubleClickText = useCallback(
    (
      screenX: number,
      screenY: number,
      worldX: number,
      worldY: number,
      element: CanvasElement,
      elementIndex: number
    ) => {
      if (isEditingText) {
        cleanupTextEditor(false);
      }
      createTextEditor(
        screenX,
        screenY,
        worldX,
        worldY,
        element.text || "",
        element,
        elementIndex
      );
    },
    [isEditingText, cleanupTextEditor, createTextEditor]
  );

  // --------------- 生成预览绘制函数 ---------------

  const buildPreviewRender = useCallback((): ((
    ctx: CanvasRenderingContext2D
  ) => void) => {
    const s = useCanvasStore.getState();
    const tool = activeTool.current;
    const p0 = startPt.current;
    const p1 = curPt.current;
    const vp = rendererRef.current?.getViewport() ?? {
      translateX: 0,
      translateY: 0,
      zoom: 1,
    };

    return (ctx: CanvasRenderingContext2D) => {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      switch (tool) {
        case "pen": {
          const pts = penPts.current;
          if (pts.length < 2) return;
          ctx.strokeStyle = s.strokeColor;
          ctx.lineWidth = s.strokeWidth;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
          break;
        }
        case "line": {
          ctx.strokeStyle = s.strokeColor;
          ctx.lineWidth = s.strokeWidth;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
          break;
        }
        case "rect": {
          const rw = Math.abs(p1.x - p0.x);
          const rh = Math.abs(p1.y - p0.y);
          const rx = Math.min(p0.x, p1.x);
          const ry = Math.min(p0.y, p1.y);
          ctx.fillStyle = s.fillColor;
          ctx.strokeStyle = s.strokeColor;
          ctx.lineWidth = s.strokeWidth;
          // 关键修复：绘制过程中也按当前 store 中的圆角半径实时预览
          const r = Math.min(s.cornerRadius || 0, rw / 2, rh / 2);
          ctx.beginPath();
          if (r > 0) {
            ctx.moveTo(rx + r, ry);
            ctx.lineTo(rx + rw - r, ry);
            ctx.arcTo(rx + rw, ry, rx + rw, ry + r, r);
            ctx.lineTo(rx + rw, ry + rh - r);
            ctx.arcTo(rx + rw, ry + rh, rx + rw - r, ry + rh, r);
            ctx.lineTo(rx + r, ry + rh);
            ctx.arcTo(rx, ry + rh, rx, ry + rh - r, r);
            ctx.lineTo(rx, ry + r);
            ctx.arcTo(rx, ry, rx + r, ry, r);
          } else {
            ctx.rect(rx, ry, rw, rh);
          }
          ctx.fill();
          ctx.stroke();
          break;
        }
        case "circle": {
          const cx = p0.x;
          const cy = p0.y;
          const rx = Math.abs(p1.x - p0.x);
          const ry = Math.abs(p1.y - p0.y);
          ctx.fillStyle = s.fillColor;
          ctx.strokeStyle = s.strokeColor;
          ctx.lineWidth = s.strokeWidth;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;
        }
        case "eraser": {
          if (!isDrawing.current) return;
          const er = ERASER_RADIUS / vp.zoom;
          ctx.strokeStyle = "#999";
          ctx.lineWidth = 1.5 / vp.zoom;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(p1.x, p1.y, er, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
      }
    };
  }, []);

  // --------------- 鼠标事件 ---------------

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // 如果正在编辑文本，先保存再处理新操作
      if (isEditingText) {
        cleanupTextEditor(true);
        return;
      }

      const renderer = (e as any)._getRenderer?.();
      if (!renderer) return;
      rendererRef.current = renderer;

      const rect = e.currentTarget.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { x, y } = renderer.screenToWorld(sx, sy);

      const tool = useCanvasStore.getState().activeTool;
      activeTool.current = tool;

      if (tool === "select") return;

      // 关键修复：image 工具的上传由 useImageUpload 接管（文件选择/拖拽/粘贴），
      // 鼠标点击不应该创建任何新元素
      if (tool === "image") return;

      if (tool === "eraser") {
        isDrawing.current = true;
        startPt.current = { x, y };
        curPt.current = { x, y };
        eraseAt(x, y, renderer.getViewport().zoom);
        renderer.addTemporaryDraw(TEMP_DRAW_ID, buildPreviewRender(), 10);
        return;
      }

      if (tool === "text") {
        // 使用统一编辑器创建新文本
        createTextEditor(e.clientX, e.clientY, x, y);
        return;
      }

      isDrawing.current = true;
      startPt.current = { x, y };
      curPt.current = { x, y };
      if (tool === "pen") penPts.current = [{ x, y }];
      renderer.addTemporaryDraw(TEMP_DRAW_ID, buildPreviewRender(), 10);
    },
    [
      store,
      buildPreviewRender,
      isEditingText,
      cleanupTextEditor,
      createTextEditor,
    ]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing.current || isEditingText) return;

      const renderer = (e as any)._getRenderer?.();
      if (!renderer) return;
      rendererRef.current = renderer;

      const rect = e.currentTarget.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { x, y } = renderer.screenToWorld(sx, sy);

      curPt.current = { x, y };
      if (activeTool.current === "pen") penPts.current.push({ x, y });
      if (activeTool.current === "eraser")
        eraseAt(x, y, renderer.getViewport().zoom);
      renderer.addTemporaryDraw(TEMP_DRAW_ID, buildPreviewRender(), 10);
    },
    [buildPreviewRender, isEditingText]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing.current || isEditingText) return;
      isDrawing.current = false;

      const renderer = rendererRef.current;
      if (renderer) {
        renderer.removeTemporaryDraw(TEMP_DRAW_ID);
      }

      const tool = activeTool.current;
      const p0 = startPt.current;
      const p1 = curPt.current;

      if (tool === "select" || tool === "eraser" || tool === "text") return;

      let el: CanvasElement | null = null;
      switch (tool) {
        case "pen": {
          if (penPts.current.length < MIN_SIZE) break;
          const b = calcBounds(penPts.current);
          el = store.createElement("pen", {
            x: b.x,
            y: b.y,
            width: Math.max(b.width, 1),
            height: Math.max(b.height, 1),
            points: [...penPts.current],
            fill: "transparent",
          });
          penPts.current = [];
          break;
        }
        case "line": {
          const b = calcBounds([p0, p1]);
          const pd = store.strokeWidth;
          el = store.createElement("line", {
            x: b.x - pd,
            y: b.y - pd,
            width: Math.max(b.width + pd * 2, MIN_SIZE),
            height: Math.max(b.height + pd * 2, MIN_SIZE),
            points: [
              { x: p0.x, y: p0.y },
              { x: p1.x, y: p1.y },
            ],
            fill: "transparent",
          });
          break;
        }
        case "rect": {
          const rx = Math.min(p0.x, p1.x);
          const ry = Math.min(p0.y, p1.y);
          const rw = Math.abs(p1.x - p0.x);
          const rh = e.shiftKey ? rw : Math.abs(p1.y - p0.y);
          if (rw < MIN_SIZE && rh < MIN_SIZE) break;
          el = store.createElement("rect", {
            x: rx,
            y: ry,
            width: Math.max(rw, MIN_SIZE),
            height: Math.max(rh, MIN_SIZE),
          });
          break;
        }
        case "circle": {
          const rx = Math.abs(p1.x - p0.x);
          const ry = e.shiftKey ? rx : Math.abs(p1.y - p0.y);
          if (rx < MIN_SIZE && ry < MIN_SIZE) break;
          el = store.createElement("circle", {
            x: p0.x - rx,
            y: p0.y - ry,
            width: rx * 2,
            height: ry * 2,
          });
          break;
        }
      }
      if (el) store.addElement(el);
    },
    [store, isEditingText]
  );

  // --------------- 橡皮擦 ---------------

  const eraseAt = useCallback(
    (wx: number, wy: number, zoom: number) => {
      const state = useCanvasStore.getState();
      const radius = ERASER_RADIUS / zoom;
      for (let i = state.elements.length - 1; i >= 0; i--) {
        const el = state.elements[i];
        if (rectCircle(el.x, el.y, el.width, el.height, wx, wy, radius)) {
          store.deleteElement(el.id);
          break;
        }
      }
    },
    [store]
  );

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    isDrawing,
    isEditingText,
    handleEraser: handleMouseDown,
    handleDoubleClickText,
    cleanupTextEditor,
  };
}

function calcBounds(pts: Point[]) {
  if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
  let mx = Infinity,
    my = Infinity,
    Mx = -Infinity,
    My = -Infinity;
  for (const p of pts) {
    if (p.x < mx) mx = p.x;
    if (p.y < my) my = p.y;
    if (p.x > Mx) Mx = p.x;
    if (p.y > My) My = p.y;
  }
  return {
    x: mx,
    y: my,
    width: Math.max(Mx - mx, 1),
    height: Math.max(My - my, 1),
  };
}

function rectCircle(
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  cx: number,
  cy: number,
  cr: number
) {
  const cX = Math.max(rx, Math.min(cx, rx + rw)),
    cY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - cX,
    dy = cy - cY;
  return dx * dx + dy * dy <= cr * cr;
}
