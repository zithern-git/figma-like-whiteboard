/**
 * 图片上传 Hook (useImageUpload)
 *
 * 关键设计（Phase 8）：
 * - 走服务端 /api/upload：上传成功后会得到一个稳定的 URL（如 /uploads/abc.png）
 *   - 协作时 URL 不会因为 base64 编码差异而同步失败
 *   - 大图片不会撑爆 Socket.IO 帧（base64 路径已被替代）
 * - 失败 / 离线时降级到 base64：保证任何场景下用户都能继续编辑
 * - 创建的 image 元素自然尺寸即 width/height，Shift 锁比例在 useElementTransform 中实现
 *
 * 边界情况处理：
 * - 超大图片（>10MB）：前端用 OffscreenCanvas 重新绘制为 JPEG 压缩后再上传
 *   - 避免服务端收到超大文件触发 multer 413
 *   - JPEG 质量 0.85 通常能把 10MB PNG 压到 1-2MB
 * - 上传失败：自动降级到 base64，让用户体验不被打断
 * - 离屏（isVisible=false）：仍然允许上传，只是网络可能慢
 */

import { useCallback, useRef } from "react";
import { CanvasRenderer } from "@/canvas/CanvasRenderer";
import type { CanvasElement } from "@/canvas/CanvasElement";
import { useCanvasStore } from "@/stores/canvasStore";
import { toast } from "@/stores/toastStore";
import api from "@/services/api";

/** 图片最大显示尺寸（保持宽高比） */
const MAX_IMAGE_DIMENSION = 800;

/** 触发前端压缩的文件大小阈值（10MB，对齐服务端 multer 限制） */
const COMPRESS_THRESHOLD_BYTES = 10 * 1024 * 1024;

/** JPEG 压缩质量（0~1） */
const COMPRESS_QUALITY = 0.85;

export function useImageUpload(renderer: CanvasRenderer | null) {
  /** 隐藏的文件选择 input 引用 */
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** 上次操作的位置（drop / paste 时复用） */
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  /**
   * 把 File 转成可用的 imageUrl，并创建 image 元素加到画布
   *
   * 工作流程：
   * 1. 校验文件类型
   * 2. 选择数据源：
   *    - 小文件（<=10MB）→ 直接 POST /api/upload
   *    - 大文件 → 前端先压缩为 JPEG，再 POST /api/upload
   *    - 失败 → 降级为 base64 dataURL
   * 3. 按图片自然宽高创建 image 元素（保持宽高比）
   * 4. 自动选中新图片
   *
   * @param file - 选中的图片文件
   * @param worldPos - 元素左上角的世界坐标；不传则放在视口中心
   */
  const handleFile = useCallback(
    async (file: File, worldPos?: { x: number; y: number }) => {
      if (!file.type.startsWith("image/")) {
        toast.warning("请选择图片文件");
        return;
      }

      const state = useCanvasStore.getState();

      // 第 1 步：探测图片自然尺寸
      const dataUrl = await readFileAsDataURL(file)
      if (!dataUrl) {
        toast.error("文件读取失败")
        return
      }
      const probe = await loadImage(dataUrl)
      let w = probe.naturalWidth
      let h = probe.naturalHeight
      if (w === 0 || h === 0) {
        toast.error("图片加载失败")
        return
      }

      // 等比缩放到 MAX_IMAGE_DIMENSION 之内（保宽高比）
      if (w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION) {
        const scale = Math.min(
          MAX_IMAGE_DIMENSION / w,
          MAX_IMAGE_DIMENSION / h
        )
        w = Math.round(w * scale)
        h = Math.round(h * scale)
      }

      // 关键修复（A/B 端图片延迟看到 bug）：
      // 之前：上传成功后才 addImageElement（HTTPS URL）
      //   - A 端 add 后 CanvasRenderer.loadImage(HTTP URL) → HTTP GET（首次访问几 MB 要几秒）
      //   - add op 携带 HTTP URL → B 端 add 后 loadImage(HTTP URL) → HTTP GET（同样要几秒）
      //   - 用户感知"A 上传完图片 A/B 都要等几秒才看到"
      // 修复：addImageElement 时**先用 base64 dataUrl**（浏览器内嵌，无 HTTP）
      //   - A 端：new Image().src = dataUrl 立即 ready（无网络），A 端 0 延迟看到
      //   - B 端：add op 携带 dataUrl（虽然 add op 几 MB，但 socket 推送几 MB 仍比 HTTP 下载几 MB 快）
      //           B 端 new Image().src = dataUrl 立即 ready，B 端 0 延迟看到
      //   - 上传完成后调 updateElement(id, { imageUrl: HTTP_URL })：
      //       - A 端自己从 dataUrl 切到 HTTP URL（持久化）
      //       - B 端 update op 改 imageUrl，从 dataUrl 切到 HTTP URL（持久化）
      //       - update op 只携带 imageUrl 字段（几 KB），socket 推送快
      //   - 极端情况：add op 推送中服务端挂掉 / 网络断 → add op 丢失但图片已 add
      //     此时 B 端刷新后用 HTTP URL（因为 update op 在 mongo 持久化后才有 imageUrl）
      //     → B 端从服务端 mongo 拉到 HTTP URL element → 走 HTTP GET（首次访问延迟）
      //     这是极少数边界情况，优先保证实时性
      const imageEl = addImageElement(state, dataUrl, w, h, worldPos, renderer)
      const elementId = imageEl.id

      // 关键修复：图片添加完成后切回 select 工具
      useCanvasStore.getState().setTool("select")

      // 第 2 步：异步上传到服务端 + 拿到 HTTP URL 后改 imageUrl
      // 走 async IIFE 不阻塞 addImageElement（add op 立即广播给 B）
      ;(async () => {
        try {
          let httpUrl: string
          if (file.size > COMPRESS_THRESHOLD_BYTES) {
            const compressed = await compressImage(dataUrl, w, h)
            httpUrl = await uploadToServer(compressed, file.name)
            toast.success(
              `已添加图片（${(file.size / 1024 / 1024).toFixed(1)}MB，已自动压缩）`
            )
          } else {
            httpUrl = await uploadToServer(dataUrl, file.name)
          }
          // 关键修复：上传完成后改 imageUrl 为 HTTP URL（持久化）
          // 走 updateElement → UpdateElementCommand.execute → 广播 update op
          // B 端 update op 改 imageUrl 为 HTTP URL，dataUrl 内存释放
          useCanvasStore.getState().updateElement(elementId, { imageUrl: httpUrl })
        } catch (err) {
          // 上传失败：保持 dataUrl（已经是降级路径）
          console.warn("[useImageUpload] 上传失败，保持 dataUrl:", err)
          toast.info("已添加图片（离线模式，未上传至服务器）")
        }
      })()
    },
    [renderer]
  );

  /**
   * 弹出系统文件选择器
   *
   * Toolbar 的图片工具被点击时，由 WhiteboardPage 通过 ref 调用
   */
  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * 隐藏文件 input 的 onChange 回调
   */
  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // 必须重置 value，否则选同一张图不会再次触发
      e.target.value = "";
      if (file) {
        handleFile(file, lastPosRef.current ?? undefined);
      }
    },
    [handleFile]
  );

  /**
   * 拖拽上传：dragenter/dragover 需要 preventDefault 才能触发 drop
   */
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  /**
   * 拖拽放下：取第一个 image/* 文件
   */
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!renderer) return;
      const file = Array.from(e.dataTransfer.files).find((f) =>
        f.type.startsWith("image/")
      );
      if (!file) return;
      e.preventDefault();
      // 用 drop 位置作为图片左上角
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const worldPos = renderer.screenToWorld(screenX, screenY);
      handleFile(file, worldPos);
    },
    [renderer, handleFile]
  );

  /**
   * 粘贴上传：监听 window 的 paste，从剪贴板 items 里找 image/*
   */
  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFile(file, lastPosRef.current ?? undefined);
            return;
          }
        }
      }
    },
    [handleFile]
  );

  return {
    fileInputRef,
    openFilePicker,
    onFileInputChange,
    onDragOver,
    onDrop,
    onPaste,
  };
}

// ============================================================
// 工具函数
// ============================================================

/** 读 File → dataURL */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (ev) => resolve((ev.target?.result as string) || "")
    reader.onerror = () => resolve("")
    reader.readAsDataURL(file)
  })
}

/** 加载图片（Promise 版） */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Image load failed"))
    img.src = src
  })
}

/**
 * 压缩图片为 JPEG dataURL
 *
 * 用 Canvas 重新绘制图片并以 JPEG 格式导出，大幅减少 base64 体积。
 * 优先使用 OffscreenCanvas（性能更好），fallback 到普通 Canvas。
 */
async function compressImage(
  dataUrl: string,
  width: number,
  height: number
): Promise<string> {
  const img = await loadImage(dataUrl)

  // 优先用 OffscreenCanvas（worker 友好，性能更好）
  const useOffscreen =
    typeof OffscreenCanvas !== "undefined" &&
    typeof (OffscreenCanvas.prototype as unknown as { convertToBlob?: unknown }).convertToBlob === "function"

  if (useOffscreen) {
    const off = new OffscreenCanvas(width, height)
    const ctx = off.getContext("2d")
    if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable")
    ctx.drawImage(img, 0, 0, width, height)
    const blob = await (off as unknown as {
      convertToBlob: (opts: { type: string; quality: number }) => Promise<Blob>
    }).convertToBlob({ type: "image/jpeg", quality: COMPRESS_QUALITY })
    return await blobToDataURL(blob)
  }

  // Fallback：普通 Canvas
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2d context unavailable")
  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toDataURL("image/jpeg", COMPRESS_QUALITY)
}

/** Blob → dataURL */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("Blob read failed"))
    reader.readAsDataURL(blob)
  })
}

/**
 * dataURL → Blob（用于上传时节省编码） */
function dataURLToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",", 2)
  const mimeMatch = header.match(/data:([^;]+);base64/)
  const mime = mimeMatch ? mimeMatch[1] : "image/png"
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

/**
 * 上传到服务端 /api/upload
 *
 * 成功时返回稳定的 URL（相对路径，如 /uploads/abc.png）；
 * 失败抛错，由调用方降级到 base64 路径。
 */
async function uploadToServer(dataUrl: string, filename: string): Promise<string> {
  const blob = dataURLToBlob(dataUrl)
  const formData = new FormData()
  // 保留原扩展名（如果能从 mime 推出来）
  const ext = blob.type.split("/")[1] || "png"
  formData.append("file", blob, filename || `image.${ext}`)

  const res = await api.post<{ success: true; data: { url: string } }>(
    "/upload",
    formData,
    {
      // 关键修复：绝对不要手动设置 Content-Type: multipart/form-data！
      // axios 在检测到 FormData body 时会自动生成带 boundary 的
      // Content-Type: multipart/form-data; boundary=----xxx，
      // boundary 是 multer 解析 multipart 各个 part 的关键分隔符。
      // 手动写死成 "multipart/form-data"（没有 boundary）会让请求体格式
      // 不合法，后端 multer 解析失败 → ERR_CONNECTION_RESET → 上传失败降级到 base64。
      //
      // silent: true — 上传失败时不弹错误 toast：
      //   1) 我们有完整的 base64 降级路径（下方 catch 兜底），图片仍能正常加入画布
      //   2) 失败时调用方会显示"已添加图片（离线模式，未上传至服务器）"的 info toast
      //   3) 弹错误 toast 会和"成功添加"形成冲突，让用户误以为操作失败
      // 注意：服务端错误（非 4xx/5xx 的网络错误）仍会被 axios 拦截器记录到 console
      silent: true,
    }
  )
  if (!res.data?.success) {
    throw new Error("[useImageUpload] 服务端返回失败")
  }
  return res.data.data.url
}

/**
 * 把图片元素加到画布
 *
 * 关键修复：保留宽高比 - 调用方传入的 w/h 已经是等比缩放后的尺寸，
 * 创建 image 元素时直接使用，保证 Shift 锁比例拖拽时的初始比例正确。
 *
 * 关键修复（A/B 端图片延迟看到 bug）：
 * 接受**任意 imageUrl**（dataUrl 或 HTTP URL）。
 * - A 端调用时传 dataUrl（base64），add op 携带 dataUrl，B 端 add op 立即 inline 显示（无 HTTP）
 * - 后续 A 端 uploadToServer 拿到 HTTP URL 后调 updateElement 改 imageUrl
 *
 * @returns 创建的 image 元素（用于 upload 后调 updateElement 改 imageUrl）
 */
function addImageElement(
  state: ReturnType<typeof useCanvasStore.getState>,
  imageUrl: string,
  w: number,
  h: number,
  worldPos: { x: number; y: number } | undefined,
  renderer: CanvasRenderer | null
): CanvasElement {
  // 计算放置位置：优先用传入的 worldPos，其次用视口中心
  let posX = 0
  let posY = 0
  if (worldPos) {
    posX = worldPos.x
    posY = worldPos.y
  } else if (renderer) {
    const v = renderer.getViewport()
    // 通过 renderer 暴露的 mainCanvas（私有字段）取得容器尺寸
    const mainCanvas = (renderer as unknown as { mainCanvas?: HTMLCanvasElement }).mainCanvas
    const cw = mainCanvas ? mainCanvas.clientWidth : window.innerWidth
    const ch = mainCanvas ? mainCanvas.clientHeight : window.innerHeight
    posX = (cw / 2 - v.translateX) / v.zoom - w / 2
    posY = (ch / 2 - v.translateY) / v.zoom - h / 2
  }

  const imageEl = state.createElement("image", {
    x: posX,
    y: posY,
    width: w,
    height: h,
    imageUrl,
  })
  // 关键修复：图片预热（A 端首次添加的优化）
  // 之前 addImageElement 之后 A 端 CanvasRenderer.loadImage 触发 HTTP GET（几秒延迟）
  // 现在 addImageElement 时 imageUrl 是 dataUrl（base64），浏览器立即 inline 显示，无需预热
  state.addElement(imageEl)
  // 创建后自动选中新图片，方便用户立即拖动或调整
  state.setSelectedIds(new Set([imageEl.id]))
  return imageEl
}
