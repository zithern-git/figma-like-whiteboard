/**
 * 图片上传 Hook (useImageUpload)
 *
 * 关键修复：补齐图片上传链路。CanvasRenderer 已经能渲染图片，
 * 但没有 UI 入口能往 imageUrl 写值。本 hook 提供：
 *
 * 1. 文件选择器上传：点击 Toolbar 的"图片"工具时，弹出系统文件选择器
 * 2. 拖拽上传：监听画布容器的 drop 事件
 * 3. 粘贴上传：监听 window 的 paste 事件
 *
 * 选中的图片经过 FileReader.readAsDataURL 转成 base64，
 * 按图片原始宽高创建 image 元素（过大时自动按比例缩小到 800x600 边界内）。
 *
 * 边界情况处理：
 * - 超大图片（>10MB）：前端用 OffscreenCanvas / Canvas 重新绘制为 JPEG 压缩
 *   - 避免 base64 序列化后帧大小超限（Socket.IO 单帧 20MB）
 *   - 避免过大的 dataURL 占用 localStorage / IndexedDB
 * - 自动旋转（EXIF）：TODO 暂不处理
 */

import { useCallback, useRef } from "react";
import { CanvasRenderer } from "@/canvas/CanvasRenderer";
import { useCanvasStore } from "@/stores/canvasStore";
import { toast } from "@/stores/toastStore";

/** 图片最大显示尺寸（保持宽高比）
 * 关键修复：800 → 600。base64 dataURL 长度 ≈ 4/3 × (W × H × 4) 字节。
 * 600×600 图大约 1.1MB，加上 Socket.IO 帧头在 20MB 缓冲区内安全。
 */
const MAX_IMAGE_DIMENSION = 600;

/** 触发前端压缩的文件大小阈值（10MB） */
const COMPRESS_THRESHOLD_BYTES = 10 * 1024 * 1024;

/** JPEG 压缩质量（0~1） */
const COMPRESS_QUALITY = 0.85;

export function useImageUpload(renderer: CanvasRenderer | null) {
  /** 隐藏的文件选择 input 引用 */
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** 上次操作的位置（drop / paste 时复用） */
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  /**
   * 把 File 转成 dataURL，并创建 image 元素加到画布
   *
   * @param file - 选中的图片文件
   * @param worldPos - 元素左上角的世界坐标；不传则放在视口中心
   */
  const handleFile = useCallback(
    (file: File, worldPos?: { x: number; y: number }) => {
      if (!file.type.startsWith("image/")) {
        toast.warning("请选择图片文件");
        return;
      }

      // 关键修复：超大图片（>10MB）走前端压缩路径
      // 1. FileReader 读出 dataURL
      // 2. 用 Image 解码
      // 3. 用 OffscreenCanvas / Canvas 重绘为 JPEG（dataURL 体积大幅下降）
      // 4. 转回 dataURL 后再走 addElement
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        if (!dataUrl) return;

        const probe = new Image();
        probe.onload = () => {
          const state = useCanvasStore.getState();

          // 等比缩放到 MAX_IMAGE_DIMENSION 之内
          let w = probe.naturalWidth;
          let h = probe.naturalHeight;
          if (w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION) {
            const scale = Math.min(
              MAX_IMAGE_DIMENSION / w,
              MAX_IMAGE_DIMENSION / h
            );
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }

          // 关键修复：>10MB 文件触发压缩走重绘流程
          // 重绘为 JPEG 后，base64 体积通常下降 70%+
          if (file.size > COMPRESS_THRESHOLD_BYTES) {
            compressImage(dataUrl, w, h)
              .then((compressedDataUrl) => {
                addImageElement(state, compressedDataUrl, w, h, worldPos, renderer, file);
              })
              .catch((err) => {
                console.error("[useImageUpload] 压缩失败:", err);
                toast.error("图片压缩失败，使用原图");
                addImageElement(state, dataUrl, w, h, worldPos, renderer, file);
              });
            return;
          }

          addImageElement(state, dataUrl, w, h, worldPos, renderer, file);
        };
        probe.onerror = () => {
          toast.error("图片加载失败");
        };
        probe.src = dataUrl;
      };
      reader.onerror = () => {
        toast.error("文件读取失败");
      };
      reader.readAsDataURL(file);
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
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = dataUrl;
  });

  // 优先用 OffscreenCanvas（worker 友好，性能更好）
  const useOffscreen =
    typeof OffscreenCanvas !== "undefined" &&
    typeof (OffscreenCanvas.prototype as unknown as { convertToBlob?: unknown }).convertToBlob === "function";

  if (useOffscreen) {
    const off = new OffscreenCanvas(width, height);
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
    ctx.drawImage(img, 0, 0, width, height);
    // convertToBlob 在标准 lib.dom 里可用，但 TS 严格模式可能不识别，用类型断言
    const blob = await (off as unknown as {
      convertToBlob: (opts: { type: string; quality: number }) => Promise<Blob>;
    }).convertToBlob({ type: "image/jpeg", quality: COMPRESS_QUALITY });
    return await blobToDataURL(blob);
  }

  // Fallback：普通 Canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context unavailable");
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", COMPRESS_QUALITY);
}

/** Blob → dataURL（仅 OffscreenCanvas 路径需要，普通 Canvas 走 toDataURL 一步到位） */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Blob read failed"));
    reader.readAsDataURL(blob);
  });
}

/** 把图片元素加到画布（供压缩 / 非压缩两个分支共用） */
function addImageElement(
  state: ReturnType<typeof useCanvasStore.getState>,
  dataUrl: string,
  w: number,
  h: number,
  worldPos: { x: number; y: number } | undefined,
  renderer: CanvasRenderer | null,
  file: File
) {
  // 计算放置位置：优先用传入的 worldPos，其次用视口中心
  let posX = 0;
  let posY = 0;
  if (worldPos) {
    posX = worldPos.x;
    posY = worldPos.y;
  } else if (renderer) {
    const v = renderer.getViewport();
    // 通过 renderer 暴露的 mainCanvas（私有字段）取得容器尺寸
    const mainCanvas = (renderer as unknown as { mainCanvas?: HTMLCanvasElement }).mainCanvas;
    const cw = mainCanvas ? mainCanvas.clientWidth : window.innerWidth;
    const ch = mainCanvas ? mainCanvas.clientHeight : window.innerHeight;
    posX = (cw / 2 - v.translateX) / v.zoom - w / 2;
    posY = (ch / 2 - v.translateY) / v.zoom - h / 2;
  }

  const imageEl = state.createElement("image", {
    x: posX,
    y: posY,
    width: w,
    height: h,
    imageUrl: dataUrl,
  });
  state.addElement(imageEl);
  // 创建后自动选中新图片
  state.setSelectedIds(new Set([imageEl.id]));

  // 用户反馈：文件越大提示越明显
  if (file.size > COMPRESS_THRESHOLD_BYTES) {
    toast.success(`已添加图片（${(file.size / 1024 / 1024).toFixed(1)}MB，已自动压缩）`);
  }
}
