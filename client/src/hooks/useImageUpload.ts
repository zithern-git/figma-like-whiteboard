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
 */

import { useCallback, useRef } from "react";
import { CanvasRenderer } from "@/canvas/CanvasRenderer";
import { useCanvasStore } from "@/stores/canvasStore";

/** 图片最大显示尺寸（保持宽高比）
 * 关键修复：800 → 600。base64 dataURL 长度 ≈ 4/3 × (W × H × 4) 字节。
 * 600×600 图大约 1.1MB，加上 Socket.IO 帧头在 20MB 缓冲区内安全。
 */
const MAX_IMAGE_DIMENSION = 600;

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
        console.warn("[useImageUpload] 不是图片文件:", file.type);
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        if (!dataUrl) return;

        // 用 HTMLImageElement 读取图片原始宽高
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

          // 计算放置位置：优先用传入的 worldPos，其次用视口中心
          let posX = 0;
          let posY = 0;
          if (worldPos) {
            posX = worldPos.x;
            posY = worldPos.y;
          } else if (renderer) {
            const v = renderer.getViewport();
            // 视口中心对应的世界坐标
            const canvas = (renderer as any).mainCanvas as HTMLCanvasElement | undefined;
            const cw = canvas ? canvas.clientWidth : window.innerWidth;
            const ch = canvas ? canvas.clientHeight : window.innerHeight;
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
        };
        probe.src = dataUrl;
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
