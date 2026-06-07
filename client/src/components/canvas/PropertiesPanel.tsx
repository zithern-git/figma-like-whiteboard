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

import { useCanvasStore } from '@/stores/canvasStore'

export default function PropertiesPanel() {
  const store = useCanvasStore()
  const selectedIds = store.selectedIds
  const elements = store.elements

  // 获取选中的元素
  const selectedElements = elements.filter((e) => selectedIds.has(e.id))
  const singleSelected = selectedElements.length === 1 ? selectedElements[0] : null

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
              {Math.round(singleSelected.opacity * 100)}%
            </div>
          </div>

          {/* 文本特有属性 */}
          {singleSelected.type === 'text' && (
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