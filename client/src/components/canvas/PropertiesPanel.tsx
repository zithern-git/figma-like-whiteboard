/**
 * 右侧属性面板组件
 *
 * 显示当前选中元素的属性，支持编辑：
 * - 位置（X, Y）
 * - 尺寸（宽度, 高度）
 * - 旋转角度
 * - 填充色和描边色
 * - 描边宽度
 * - 透明度
 * - 字号（文本元素）
 *
 * 未选中元素时显示画布全局属性。
 */

import { useEffect, useState } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'

export default function PropertiesPanel() {
  const store = useCanvasStore()
  const selectedIds = store.selectedIds
  const elements = store.elements

  // 获取选中的元素（必须在 useEffect 之前声明，否则 probeUrl 引用会报 TDZ 错误）
  const selectedElements = elements.filter((e) => selectedIds.has(e.id))
  const singleSelected = selectedElements.length === 1 ? selectedElements[0] : null

  // 关键修复：用 useState 缓存选中图片的自然尺寸，避免每次渲染都 new Image()
  const [imageNaturalSize, setImageNaturalSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  })
  const probeUrl = singleSelected?.type === 'image' ? (singleSelected as any).imageUrl : null
  useEffect(() => {
    if (!probeUrl) {
      setImageNaturalSize({ w: 0, h: 0 })
      return
    }
    const probe = new Image()
    probe.onload = () =>
      setImageNaturalSize({ w: probe.naturalWidth, h: probe.naturalHeight })
    probe.src = probeUrl
  }, [probeUrl])

  /** 更新单个属性 */
  const updateProperty = (key: string, value: number | string) => {
    if (!singleSelected) return
    store.updateElement(singleSelected.id, { [key]: value })
  }

  /** 更新所有选中元素的属性 */
  const updateMultiProperty = (key: string, value: number | string) => {
    for (const id of selectedIds) {
      store.updateElement(id, { [key]: value })
    }
  }

  return (
    <div className="w-60 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-auto">
      <div className="p-3 border-b border-gray-200">
        <h3 className="text-sm font-medium text-gray-700">
          {singleSelected ? '元素属性' : selectedElements.length > 1 ? `${selectedElements.length} 个元素` : '画布属性'}
        </h3>
      </div>

      {singleSelected ? (
        <div className="p-3 space-y-4">
          {/* 位置 */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">位置</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <span className="text-xs text-gray-400">X</span>
                <input
                  type="number"
                  value={Math.round(singleSelected.x)}
                  onChange={(e) => updateProperty('x', Number(e.target.value))}
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1"
                />
              </div>
              <div className="flex-1">
                <span className="text-xs text-gray-400">Y</span>
                <input
                  type="number"
                  value={Math.round(singleSelected.y)}
                  onChange={(e) => updateProperty('y', Number(e.target.value))}
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1"
                />
              </div>
            </div>
          </div>

          {/* 尺寸 */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">尺寸</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <span className="text-xs text-gray-400">W</span>
                <input
                  type="number"
                  value={Math.round(singleSelected.width)}
                  onChange={(e) => updateProperty('width', Number(e.target.value))}
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1"
                />
              </div>
              <div className="flex-1">
                <span className="text-xs text-gray-400">H</span>
                <input
                  type="number"
                  value={Math.round(singleSelected.height)}
                  onChange={(e) => updateProperty('height', Number(e.target.value))}
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1"
                />
              </div>
            </div>
          </div>

          {/* 旋转 */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">旋转</label>
            <input
              type="range"
              min="0"
              max="360"
              value={(singleSelected.rotation * 180) / Math.PI}
              onChange={(e) => updateProperty('rotation', (Number(e.target.value) * Math.PI) / 180)}
              className="w-full"
            />
            <div className="text-xs text-gray-400 text-center">
              {Math.round((singleSelected.rotation * 180) / Math.PI)}°
            </div>
          </div>

          {/* 颜色 */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">填充色</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={singleSelected.fill}
                onChange={(e) => updateProperty('fill', e.target.value)}
                className="w-8 h-8 border border-gray-200 rounded cursor-pointer"
              />
              <input
                type="text"
                value={singleSelected.fill}
                onChange={(e) => updateProperty('fill', e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-gray-500">描边色</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={singleSelected.stroke}
                onChange={(e) => updateProperty('stroke', e.target.value)}
                className="w-8 h-8 border border-gray-200 rounded cursor-pointer"
              />
              <input
                type="text"
                value={singleSelected.stroke}
                onChange={(e) => updateProperty('stroke', e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1"
              />
            </div>
          </div>

          {/* 描边宽度 */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">描边宽度</label>
            <input
              type="range"
              min="0"
              max="20"
              step="0.5"
              value={singleSelected.strokeWidth}
              onChange={(e) => updateProperty('strokeWidth', Number(e.target.value))}
              className="w-full"
            />
            <div className="text-xs text-gray-400 text-center">
              {singleSelected.strokeWidth}px
            </div>
          </div>

          {/* 透明度 */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">透明度</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={singleSelected.opacity}
              onChange={(e) => updateProperty('opacity', Number(e.target.value))}
              className="w-full"
            />
            <div className="text-xs text-gray-400 text-center">
              {/* 关键修复：百分比直接跟随滑块位置显示，不再做反转 */}
              {Math.round((singleSelected.opacity || 0) * 100)}%
            </div>
          </div>

          {/* 文本特有属性 */}
          {singleSelected.type === 'text' && (
            <div className="space-y-3">
              {/* 字号 */}
              <div className="space-y-2">
                <label className="text-xs text-gray-500">字号</label>
                <input
                  type="number"
                  min="8"
                  max="200"
                  value={singleSelected.fontSize || 16}
                  onChange={(e) => updateProperty('fontSize', Number(e.target.value))}
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1"
                />
              </div>

              {/* 字体 */}
              <div className="space-y-2">
                <label className="text-xs text-gray-500">字体</label>
                <select
                  value={singleSelected.fontFamily || 'Arial'}
                  onChange={(e) => updateProperty('fontFamily', e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1 bg-white"
                >
                  <option value="Arial">Arial</option>
                  <option value="Helvetica">Helvetica</option>
                  <option value="Times New Roman">Times New Roman</option>
                  <option value="Georgia">Georgia</option>
                  <option value="Courier New">Courier New</option>
                  <option value="monospace">monospace</option>
                  <option value="serif">serif</option>
                  <option value="sans-serif">sans-serif</option>
                </select>
              </div>

              {/* 颜色 */}
              <div className="space-y-2">
                <label className="text-xs text-gray-500">文字颜色</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={singleSelected.textColor || singleSelected.fill || '#000000'}
                    onChange={(e) => updateProperty('textColor', e.target.value)}
                    className="w-8 h-8 border border-gray-200 rounded cursor-pointer"
                  />
                  <input
                    type="text"
                    value={singleSelected.textColor || singleSelected.fill || '#000000'}
                    onChange={(e) => updateProperty('textColor', e.target.value)}
                    className="flex-1 text-sm border border-gray-200 rounded px-2 py-1"
                  />
                </div>
              </div>

              {/* 对齐方式 */}
              <div className="space-y-2">
                <label className="text-xs text-gray-500">对齐方式</label>
                <div className="flex gap-1">
                  {(['left', 'center', 'right'] as const).map((align) => (
                    <button
                      key={align}
                      onClick={() => updateProperty('textAlign', align)}
                      className={`flex-1 px-2 py-1 text-sm border rounded ${
                        (singleSelected.textAlign || 'left') === align
                          ? 'bg-blue-500 text-white border-blue-500'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {align === 'left' ? '左' : align === 'center' ? '中' : '右'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bold / Italic 切换 */}
              <div className="space-y-2">
                <label className="text-xs text-gray-500">字形</label>
                <div className="flex gap-1">
                  <button
                    onClick={() =>
                      updateProperty(
                        'fontWeight',
                        singleSelected.fontWeight === 'bold' ? 'normal' : 'bold'
                      )
                    }
                    className={`flex-1 px-2 py-1 text-sm font-bold border rounded ${
                      singleSelected.fontWeight === 'bold'
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    B
                  </button>
                  <button
                    onClick={() =>
                      updateProperty(
                        'fontStyle',
                        singleSelected.fontStyle === 'italic' ? 'normal' : 'italic'
                      )
                    }
                    className={`flex-1 px-2 py-1 text-sm italic border rounded ${
                      singleSelected.fontStyle === 'italic'
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    I
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 矩形特有属性：圆角半径 */}
          {singleSelected.type === 'rect' && (
            <div className="space-y-2">
              <label className="text-xs text-gray-500">圆角半径</label>
              <input
                type="range"
                min="0"
                max={Math.max(50, Math.floor(Math.min(singleSelected.width, singleSelected.height) / 2))}
                step="1"
                value={singleSelected.cornerRadius || 0}
                onChange={(e) => updateProperty('cornerRadius', Number(e.target.value))}
                className="w-full"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max={Math.floor(Math.min(singleSelected.width, singleSelected.height) / 2)}
                  value={Math.round(singleSelected.cornerRadius || 0)}
                  onChange={(e) => updateProperty('cornerRadius', Number(e.target.value))}
                  className="flex-1 text-sm border border-gray-200 rounded px-2 py-1"
                />
                <span className="text-xs text-gray-400">px</span>
              </div>
            </div>
          )}

          {/* 关键修复：图片元素特有属性 — 替换图片 + 源矩形（裁剪） */}
          {singleSelected.type === 'image' && (
            <div className="space-y-3">
              {/* 替换图片 */}
              <div className="space-y-2">
                <label className="text-xs text-gray-500">图片</label>
                <div className="flex items-center gap-2">
                  {singleSelected.imageUrl && (
                    <img
                      src={singleSelected.imageUrl}
                      alt=""
                      className="w-12 h-12 object-cover border border-gray-200 rounded"
                    />
                  )}
                  <label className="flex-1 px-2 py-1 text-sm text-center border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                    替换图片
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (!file) return
                        const reader = new FileReader()
                        reader.onload = (ev) => {
                          const dataUrl = ev.target?.result as string
                          if (dataUrl) {
                            // 替换图片：保留原位置/尺寸，重置源矩形为全图
                            updateProperty('imageUrl', dataUrl)
                            updateProperty('sourceX', 0)
                            updateProperty('sourceY', 0)
                            updateProperty('sourceWidth', undefined)
                            updateProperty('sourceHeight', undefined)
                          }
                        }
                        reader.readAsDataURL(file)
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* 源矩形（裁剪） */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-gray-500">源矩形（裁剪 / 缩放）</label>
                  <button
                    onClick={() => {
                      updateProperty('sourceX', undefined)
                      updateProperty('sourceY', undefined)
                      updateProperty('sourceWidth', undefined)
                      updateProperty('sourceHeight', undefined)
                    }}
                    className="text-xs text-blue-500 hover:underline"
                  >
                    重置 = 显示全图
                  </button>
                </div>
                {(() => {
                  // 关键修复：使用 useEffect 缓存的自然尺寸（避免每次渲染都 new Image()）
                  const nw = imageNaturalSize.w
                  const nh = imageNaturalSize.h
                  return (
                    <>
                      {(['sourceX', 'sourceY', 'sourceWidth', 'sourceHeight'] as const).map((field) => {
                        // 关键修复：字段为 undefined 时显示空字符串（不是 0）
                        // 这样用户能区分"未设置"和"显式设为 0"
                        const raw = (singleSelected as any)[field]
                        const isUnset = raw === undefined
                        const natural = field.endsWith('Width') ? nw : field.endsWith('Height') ? nh : null
                        const pct = !isUnset && natural && natural > 0
                          ? `(${Math.round(((raw as number) / natural) * 100)}%)`
                          : ''
                        return (
                          <div key={field} className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-20">{field}</span>
                            <input
                              type="number"
                              min="0"
                              // 关键修复：undefined → 空字符串，真正允许"留空"
                              value={isUnset ? '' : String(raw)}
                              onChange={(e) => {
                                const v = e.target.value
                                if (v === '') {
                                  updateProperty(field, undefined)
                                } else {
                                  updateProperty(field, Number(v))
                                }
                              }}
                              className="flex-1 text-sm border border-gray-200 rounded px-2 py-1"
                              placeholder={natural ? `默认=${natural}` : '默认=全图'}
                            />
                            <span className="text-xs text-gray-400 w-10 text-right">{pct}</span>
                          </div>
                        )
                      })}
                      {(nw > 0 || nh > 0) && (
                        <div className="text-xs text-gray-400">
                          自然尺寸 {nw} × {nh}
                        </div>
                      )}
                    </>
                  )
                })()}
                <div className="mt-2 px-2.5 py-2 bg-blue-50 border border-blue-100 rounded-md space-y-1">
                  <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-blue-700">
                    <span className="shrink-0 mt-0.5 w-1 h-1 rounded-full bg-blue-400" />
                    <span>留空 = 显示整张原图；</span>
                  </div>
                  <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-blue-700">
                    <span className="shrink-0 mt-0.5 w-1 h-1 rounded-full bg-blue-400" />
                    <span>缩小 sourceW/H = 把局部区域放大铺满；</span>
                  </div>
                  <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-blue-700">
                    <span className="shrink-0 mt-0.5 w-1 h-1 rounded-full bg-blue-400" />
                    <span>调整 sx / sy = 把视口平移到原图其他位置；</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : selectedElements.length > 1 ? (
        <div className="p-3 space-y-4">
          {/* 批量编辑 */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">批量修改颜色</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={store.strokeColor}
                onChange={(e) => {
                  store.setStrokeColor(e.target.value)
                  updateMultiProperty('stroke', e.target.value)
                }}
                className="w-8 h-8 border border-gray-200 rounded cursor-pointer"
              />
              <span className="text-sm text-gray-600 self-center">描边色</span>
            </div>
            <div className="flex gap-2">
              <input
                type="color"
                value={store.fillColor}
                onChange={(e) => {
                  store.setFillColor(e.target.value)
                  updateMultiProperty('fill', e.target.value)
                }}
                className="w-8 h-8 border border-gray-200 rounded cursor-pointer"
              />
              <span className="text-sm text-gray-600 self-center">填充色</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-3 space-y-4">
          {/* 全局属性 */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">默认描边色</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={store.strokeColor}
                onChange={(e) => store.setStrokeColor(e.target.value)}
                className="w-8 h-8 border border-gray-200 rounded cursor-pointer"
              />
              <input
                type="text"
                value={store.strokeColor}
                onChange={(e) => store.setStrokeColor(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-gray-500">默认填充色</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={store.fillColor}
                onChange={(e) => store.setFillColor(e.target.value)}
                className="w-8 h-8 border border-gray-200 rounded cursor-pointer"
              />
              <input
                type="text"
                value={store.fillColor}
                onChange={(e) => store.setFillColor(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-gray-500">默认描边宽度</label>
            <input
              type="range"
              min="0.5"
              max="20"
              step="0.5"
              value={store.strokeWidth}
              onChange={(e) => store.setStrokeWidth(Number(e.target.value))}
              className="w-full"
            />
            <div className="text-xs text-gray-400 text-center">{store.strokeWidth}px</div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-gray-500">默认字号</label>
            <input
              type="number"
              min="8"
              max="200"
              value={store.fontSize}
              onChange={(e) => store.setFontSize(Number(e.target.value))}
              className="w-full text-sm border border-gray-200 rounded px-2 py-1"
            />
          </div>

          {/* 默认字体 */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">默认字体</label>
            <select
              value={store.fontFamily}
              onChange={(e) => store.setFontFamily(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded px-2 py-1 bg-white"
            >
              <option value="Arial">Arial</option>
              <option value="Helvetica">Helvetica</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Georgia">Georgia</option>
              <option value="Courier New">Courier New</option>
              <option value="monospace">monospace</option>
              <option value="serif">serif</option>
              <option value="sans-serif">sans-serif</option>
            </select>
          </div>

          {/* 默认文字颜色 */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">默认文字颜色</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={store.textColor}
                onChange={(e) => store.setTextColor(e.target.value)}
                className="w-8 h-8 border border-gray-200 rounded cursor-pointer"
              />
              <input
                type="text"
                value={store.textColor}
                onChange={(e) => store.setTextColor(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1"
              />
            </div>
          </div>

          {/* 默认字形 B / I */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">默认字形</label>
            <div className="flex gap-1">
              <button
                onClick={() => store.setFontWeight(store.fontWeight === 'bold' ? 'normal' : 'bold')}
                className={`flex-1 px-2 py-1 text-sm font-bold border rounded ${
                  store.fontWeight === 'bold'
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                B
              </button>
              <button
                onClick={() => store.setFontStyle(store.fontStyle === 'italic' ? 'normal' : 'italic')}
                className={`flex-1 px-2 py-1 text-sm italic border rounded ${
                  store.fontStyle === 'italic'
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                I
              </button>
            </div>
          </div>

          {/* 默认对齐 */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">默认对齐</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map((align) => (
                <button
                  key={align}
                  onClick={() => store.setTextAlign(align)}
                  className={`flex-1 px-2 py-1 text-sm border rounded ${
                    store.textAlign === align
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {align === 'left' ? '左' : align === 'center' ? '中' : '右'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-gray-500">默认圆角半径</label>
            <input
              type="range"
              min="0"
              max="50"
              step="1"
              value={store.cornerRadius}
              onChange={(e) => store.setCornerRadius(Number(e.target.value))}
              className="w-full"
            />
            <div className="text-xs text-gray-400 text-center">{store.cornerRadius}px</div>
          </div>

          <div className="pt-4 border-t border-gray-200">
            <div className="text-xs text-gray-500 space-y-1">
              <div>元素数量: {elements.length}</div>
              <div>选中数量: {selectedIds.size}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}