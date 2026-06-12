import mongoose from 'mongoose'
import Whiteboard from './src/models/Whiteboard'

/**
 * 数据修复脚本：删除所有缺少 type 字段的元素。
 * 背景：之前 update op 用 `{$set: {'elements.$[elem]': {...updates, id}}}` 会把
 * 整个 element 替换为只剩 diff 字段，导致 type/width/height/fill/stroke 全丢。
 * 这样的元素无法渲染，留着会污染画布。
 *
 * 使用：
 *   cd server
 *   npx ts-node --transpile-only inspect-db.ts
 */
async function main() {
  await mongoose.connect('mongodb://8.138.101.146:27017/whiteboard')
  const wbs = await Whiteboard.find({}).lean()
  console.log('Total whiteboards:', wbs.length)

  let totalRemoved = 0
  for (const w of wbs) {
    const elements = (w.elements as any[]) || []
    const valid = elements.filter((el) => !!el && !!el.type)
    const removed = elements.length - valid.length
    if (removed > 0) {
      console.log(`Whiteboard ${w.shortId}: removing ${removed} corrupt elements (of ${elements.length})`)
      await Whiteboard.updateOne({ _id: w._id }, { $set: { elements: valid } })
      totalRemoved += removed
    }
    console.log('---')
    console.log('  _id:', w._id.toString())
    console.log('  shortId:', w.shortId)
    console.log('  name:', w.name)
    console.log('  ownerId:', w.ownerId)
    console.log('  collaborators:', JSON.stringify(w.collaborators))
    console.log('  elements.length:', valid.length)
    valid.forEach((el, i) => {
      console.log(`  element[${i}] type=${el.type} id=${el.id} x=${el.x} y=${el.y}`)
    })
  }
  console.log(`\nDone. Removed ${totalRemoved} corrupt elements.`)
  await mongoose.disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
