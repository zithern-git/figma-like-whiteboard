/**
 * 图片上传 Hook (useImageUpload)
 *
 * 关键设计（Phase 8）：
 * - 走服务端 /api/upload：上传成功后会得到一个稳定的 URL（如 /uploads/abc.png）
 *   - 协作时 URL 不会因为 base64 编码差异而同步失败
 *   - 大图片不会撑爆 Socket.IO 帧（add op 只携带 blobUrl ~50 字符，不携带 dataUrl）
 * - 失败 / 离线时降级到 blobUrl（本地内存引用）：保证任何场景下用户都能继续编辑
 *   - 关键：blobUrl 几十字符，add op 也不大 → 不会污染 store / op
 * - 创建的 image 元素自然尺寸即 width/height，Shift 锁比例在 useElementTransform 中实现
 *
 * 关键修复（图片上传后所有协同操作变慢 — 终极根因）：
 * - 之前用 readFileAsDataURL(file) 把 File 转成 base64 字符串（几十~100KB），
 *   addImageElement 时 imageUrl = dataUrl，存到 store.elements 数组里。
 *   → 后续所有操作的 React re-render 都要遍历大 element 数组，shallow compare
 *     大 element 对象（imageUrl 几十~100KB），每个 re-render 耗时几十 ms。
 *   → add op 也携带完整 dataUrl，socket.io 内部 JSON.stringify 同步阻塞 A 端主线程几十 ms。
 *   → 用户感知"上传图片后所有协同操作都变慢"。
 *   → 删除图片后：image element 从 store 移除，re-render 不再处理大 element，所以不慢。
 * - 修复：用 URL.createObjectURL(file) 创建 blobUrl（~50 字符，本地内存引用），
 *   addImageElement(imageUrl=blobUrl)。
 *   - A 端：blobUrl 立即 ready（A 端 0 延迟看到图片）
 *   - B 端：blobUrl 不可用（占位框），等 update op 携带 httpUrl 才显示
 *   - 关键：store 里的 imageUrl 始终是小字符串，所有 op 都小，所有 re-render 都快
 *
 * 边界情况处理：
 * - 超大图片（>10MB）：前端用 OffscreenCanvas 重新绘制为 JPEG Blob 压缩后再上传
 *   - 避免服务端收到超大文件触发 multer 413
 *   - JPEG 质量 0.85 通常能把 10MB PNG 压到 1-2MB
 * - 上传失败：自动降级到 blobUrl，让用户体验不被打断（A 端仍能看到，B 端占位框）
 * - 离屏（isVisible=false）：仍然允许上传，只是网络可能慢
 */

import { useCallback, useRef } from "react";
import { CanvasRenderer } from "@/canvas/CanvasRenderer";
import type { CanvasElement } from "@/canvas/CanvasElement";
import { useCanvasStore } from "@/stores/canvasStore";
import { toast } from "@/stores/toastStore";

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
   * 工作流程（v3 — 终极稳定方案）：
   * 1. 校验文件类型
   * 2. 探测图片自然宽高
   * 3. **关键**：先 POST /api/upload 拿到稳定 httpUrl
   *    - 拿到 httpUrl 后再 addImageElement(httpUrl)
   *    - A 端 imageUrl=httpUrl（小字符串），B 端也是 httpUrl
   *    - 没有 update op，没有时序问题，没有"upload 失败导致 B 端永远占位框"的隐患
   * 4. 按图片自然宽高创建 image 元素（保持宽高比）
   * 5. 自动选中新图片
   *
   * 关键修复（B 端"加载中"永远不消失 — 终极根因）：
   * v2 方案（addImageElement(blobUrl) + 后台 upload + updateElement(httpUrl)）的隐患：
   *   - A 端 imageUrl=blobUrl（A 端本地内存引用，0 延迟看到）
   *   - B 端 imageUrl=blobUrl（B 端**无法访问** blob URL → 永远占位框"加载中..."）
   *   - A 端 upload 完成后 updateElement(imageUrl=httpUrl) broadcast update op
   *   - B 端 receive update op 后 imageUrl=httpUrl → loadImage(httpUrl) → 异步加载
   *   - **3 个隐患**导致 B 端**永远**占位框：
   *     1) A 端 upload 失败（网络/服务端）→ updateElement 不执行 → A 端保持 blobUrl → B 端永远占位框
   *     2) A 端 disconnect / 关闭页面之前没发完 update op → B 端永远占位框
   *     3) update op 丢失/时序问题 → B 端收不到 → B 端永远占位框
   * v3 方案（先 upload + addImageElement(httpUrl)）彻底解决：
   *   - A 端 imageUrl=httpUrl（小字符串），B 端也是 httpUrl
   *   - add op 携带 httpUrl（不是 blobUrl）→ B 端 receive 后 loadImage(httpUrl) 立即开始 HTTP 加载
   *   - 没有 update op，没有"先 add 后 update"的时序依赖
   *   - upload 失败：直接 toast 错误，不 addElement（不会留下"半成品"占位框）
   *   - **关键**：store 里的 imageUrl 始终是 httpUrl（小字符串）→ 所有协同操作都流畅
   *   - **A 端用户感知**：上传后等几百 ms（先 upload）才能看到图片——可接受的代价
   *     （换来 B 端也能立即看到 + 永远不会有"加载中"死锁）
   *
   * 边界情况处理：
   * - 超大图片（>10MB）：前端用 OffscreenCanvas 重新绘制为 JPEG Blob 压缩后再上传
   * - 上传失败：直接 toast 错误，不 addElement
   * - 离屏（isVisible=false）：仍然允许上传，只是网络可能慢
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

      // ========== 第 1 步：探测图片自然尺寸（用 blobUrl，本地内存引用不污染 store）==========
      const probeBlobUrl = URL.createObjectURL(file)
      let probe: HTMLImageElement
      try {
        probe = await loadImage(probeBlobUrl)
      } catch (err) {
        URL.revokeObjectURL(probeBlobUrl)
        console.error("[useImageUpload] 图片探测失败:", err)
        toast.error("图片加载失败")
        return
      }
      let w = probe.naturalWidth
      let h = probe.naturalHeight
      URL.revokeObjectURL(probeBlobUrl) // 探测完立即释放
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

      // ========== 第 2 步：v4 混合方案 — A 端立即 addImageElement(blobUrl) ==========
      // 设计目标：
      // - A 端：上传成功后立即看到图（0 延迟，用 blobUrl 本地内存引用）
      // - A 端：后台异步 upload → 拿到 httpUrl → updateElement 升级到 httpUrl
      // - B 端：receive add op 时 imageUrl=blobUrl（B 端无法访问 blobUrl）
      //   → 显示"等待上传..."占位（不会"永远加载中"，B 端有视觉反馈）
      // - A 端 upload 成功：广播 update op(imageUrl=httpUrl) → B 端立即 loadImage(httpUrl)
      // - A 端 upload 失败：toast 提示"图片上传失败，仅本地可见"，A 端保留 blobUrl
      //   - B 端继续显示"等待上传..."占位
      //   - 用户体验：图片至少在 A 端能看到，upload 失败不会丢失用户的图
      // - 关键：store 里的 imageUrl 始终是小字符串（blobUrl ~50 字符 或 httpUrl ~50 字符）
      //   → 所有协同操作都流畅，不会有"图片上传后所有操作变慢"的问题
      const blobUrl = URL.createObjectURL(file)
      const imageEl = addImageElement(state, blobUrl, w, h, worldPos, renderer)
      // 切回 select 工具
      useCanvasStore.getState().setTool("select")

      // ========== 第 3 步：后台异步 upload → 拿到 httpUrl → updateElement 升级 ==========
      // 注意：用 .then().catch() 而不是 await，让 A 端 UI 不阻塞
      ;(async () => {
        let httpUrl: string
        try {
          if (file.size > COMPRESS_THRESHOLD_BYTES) {
            const compressed = await compressImageFile(file, w, h)
            httpUrl = await uploadToServer(compressed, file.name)
          } else {
            httpUrl = await uploadToServer(file, file.name)
          }
        } catch (err: any) {
          // 详细错误日志：帮助定位上传失败根因
          const status = err?.response?.status
          const respData = err?.response?.data
          const errMsg = err?.message
          const errCode = err?.code
          console.error("[useImageUpload] 上传失败:", {
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            status,
            respData,
            errMsg,
            errCode,
            isAxiosError: err?.isAxiosError,
          })
          // 构造用户友好的错误提示
          let userMsg = "图片上传失败，仅本地可见"
          if (status === 413) {
            userMsg = "图片太大（>10MB），仅本地可见"
          } else if (status) {
            userMsg = `图片上传失败 (${status})，仅本地可见`
          } else if (errCode === "ERR_NETWORK") {
            userMsg = "图片上传失败：网络异常，仅本地可见"
          } else if (errCode === "ECONNABORTED") {
            userMsg = "图片上传失败：请求超时，仅本地可见"
          } else if (respData?.error?.message) {
            userMsg = `图片上传失败：${respData.error.message}，仅本地可见`
          }
          toast.warning(userMsg)
          return // upload 失败：A 端保留 blobUrl，B 端继续显示"等待上传"
        }

        // upload 成功：updateElement 升级 imageUrl=httpUrl
        // - A 端：CanvasRenderer 看到 imageUrl 变化（httpUrl）→ 立即 loadImage(httpUrl)
        // - B 端：receive update op → loadImage(httpUrl) → 立即看到图
        // - 释放 blobUrl（避免内存泄漏）
        try {
          useCanvasStore.getState().updateElement(imageEl.id, {
            imageUrl: httpUrl,
          })
          URL.revokeObjectURL(blobUrl) // 升级后释放 blobUrl
        } catch (err) {
          console.error("[useImageUpload] updateElement 失败:", err)
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
 * 压缩图片为 JPEG Blob
 *
 * 关键修复（图片上传后所有协同操作变慢）：
 * - 之前 compressImage 接受 dataUrl，需要先 readFileAsDataURL(file) 拿到
 *   几十~100KB base64 字符串，再用 canvas 重新绘制 + toDataURL 输出 dataUrl。
 *   → 整个流程会产生大 dataUrl 字符串，污染调用栈（虽然只用于上传，不入 store）
 * - 现在 compressImageFile 接受 File / Blob：
 *   - 直接 URL.createObjectURL(file) 拿到 blobUrl（A 端本地内存引用）
 *   - canvas 重新绘制 + convertToBlob 输出 Blob（不是 dataUrl）
 *   - 关键：全程不产生大字符串（避免阻塞）
 */
async function compressImageFile(
  file: File | Blob,
  width: number,
  height: number
): Promise<Blob> {
  const blobUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(blobUrl)

    // 优先用 OffscreenCanvas（worker 友好，性能更好）
    const useOffscreen =
      typeof OffscreenCanvas !== "undefined" &&
      typeof (OffscreenCanvas.prototype as unknown as { convertToBlob?: unknown }).convertToBlob === "function"

    if (useOffscreen) {
      const off = new OffscreenCanvas(width, height)
      const ctx = off.getContext("2d")
      if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable")
      ctx.drawImage(img, 0, 0, width, height)
      return await (off as unknown as {
        convertToBlob: (opts: { type: string; quality: number }) => Promise<Blob>
      }).convertToBlob({ type: "image/jpeg", quality: COMPRESS_QUALITY })
    }

    // Fallback：普通 Canvas → toBlob
    return await new Promise<Blob>((resolve, reject) => {
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        reject(new Error("Canvas 2d context unavailable"))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error("canvas.toBlob failed"))
        },
        "image/jpeg",
        COMPRESS_QUALITY
      )
    })
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

/**
 * 上传到服务端 /api/upload
 *
 * 关键修复（v4.1 终极稳定 — 修复 upload 400 错误）：
 * - 之前用 axios.post('/upload', formData, { silent: true })
 * - 但项目级 axios.create 时设了默认 Content-Type: 'application/json'
 * - axios 的 transformRequest 检测到 Content-Type 包含 'application/json' 时
 *   会把 FormData 错误地序列化成 JSON 字符串（formDataToJSON）
 * - 结果：multer 收到 application/json 的 body，无法解析为 multipart → 400 错误
 * - 之前一切 API 调用（auth/whiteboards）都是 JSON，所以默认 Content-Type 是合理的
 * - 唯一 FormData 的就是 upload，这里改用**原生 fetch**绕过 axios 的 transformRequest
 *
 * 关键修复（图片上传后所有协同操作变慢）：
 * - 现在 uploadToServer 接受 File / Blob：
 *   - 直接 formData.append("file", blob) → 浏览器原生 multipart 编码
 *   - 全程不产生大字符串
 *
 * @param blob - 图片二进制（File 或 Blob）
 * @param filename - 文件名（含扩展名）
 * @returns 服务端返回的稳定 URL（相对路径，如 /uploads/abc.png）
 */
async function uploadToServer(blob: Blob, filename: string): Promise<string> {
  const formData = new FormData()
  // 保留扩展名（如果能从 mime 推出来）
  const ext = blob.type.split("/")[1] || "png"
  formData.append("file", blob, filename || `image.${ext}`)

  // 用原生 fetch 绕过 axios 的 transformRequest（不让 FormData 被错误地转成 JSON）
  // 注意：绝对不要手动设置 Content-Type 头！浏览器会自动设置带 boundary 的
  //       multipart/form-data，手动设会导致 multer 解析失败。
  const token = localStorage.getItem("token")
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  })

  if (!res.ok) {
    // 提取后端错误信息（如果有）
    let errMsg = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (data?.error?.message) errMsg = data.error.message
    } catch {
      // 忽略 JSON 解析错误
    }
    throw new Error(`upload failed: ${errMsg}`)
  }

  const data = await res.json()
  if (!data?.success) {
    throw new Error("[useImageUpload] 服务端返回失败")
  }
  return data.data.url
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
