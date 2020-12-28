#! /usr/bin/env node
const Koa = require('koa')
const send = require('koa-send')
const path = require('path')
const { Readable } = require('stream')
const compilerSFC = require('@vue/compiler-sfc')
const app = new Koa()

// 把流转换为字符串
const streamToString = stream => {
  // 异步读取，所以返回promise
  return new Promise((resolve, reject) => {
    const chunks = []
    stream.on('data', chunk => chunks.push(chunk))
    // 将chunks中的buffer数据进行合并，然后转换成字符串。
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    stream.on('error', reject)
  })
}

// 把流转换成字符串
const stringToStream = str => {
  const stream = new Readable()
  stream.push(text)
  stream.push(null)
  return stream
}

// 当请求的路径为/@modules开头的时候，把请求的路径修改成node_modules中对应的文件路径，然后继续交给静态文件服务器
// 3. 加载第三方模块
app.use(async (ctx, next) => {
  console.log(ctx.path)
  // ctx.path 是否 是以/@modules/vue开头
  if (ctx.path.startsWith('/@modules/')) {
    const modulesName = ctx.path.substr(10)
    const pkgPath = path.join(process.cwd(), 'node_modules', modulesName, 'package.json')
    const pkg = require(pkgPath)
    ctx.path = path.join('/node_modules', modulesName, pkg.module)
  }
  await next()
})
// 1. 静态文件服务器
app.use(async (ctx, next) => {
  await send(ctx, ctx.path, { root: process.cwd(), index: 'index.html' })
  await next()
})

// 4. 如何处理单文件组件 import App from './App.vue'
// 为什么在这里书写？ 因为单文件组件是一个静态文件， 当请求到这个地址交由静态文件服务器返回静态文件之后，返回给这个中间件使用，当这个中间件使用完毕，因为单文件组件可能会去请求其他的第三方模块， import xx from 'xx' 所以需要交由下一个中间件进行处理。
// 需要安装 npm i @vue/compiler-sfc
// 需要发送两次请求，第一次是将单文件组件编译成一个对象，第二次是编译单文件组件的模板，编译成render函数，然后将render函数放到第一次编译成对象的render函数上。
app.use(async (ctx, next) => {
  if (ctx.path.endsWith('.vue')) {
    const contents = await streamToString(ctx.body) // ctx.body中的是单文件组件的内容，这里将单文件组件中的内容转换为字符串
    const { descriptor } = compilerSFC.parse(contents) // 获取到descriptor： 单文件组件的描述对象。还有一个是erros，编译过程中收集的错误。
    let code // 返回给浏览器的最终的code。
    // 没有type属性就是第一次请求， 需要拿到编译后的内容然后拼接上指定的字符串，
    if (!ctx.query.type) {
      code = descriptor.script.content // 当前单文件组件编译的js代码
      // 对code进行处理
      code = code.replace(/export\s+default\s+/g, 'const __script = ')
      // import {render as __render} from "${ctx.path}?type=template"  是发送的第二次请求
      code += `
        import {render as __render} from "${ctx.path}?type=template"
        __script.render = __render
        export default __script
      `
    } else if (ctx.query.type === 'template') {
      const templateRender = compilerSFC.compileTemplate({ source: descriptor.template.content })
      code = templateRender.code
    }
    ctx.type = 'application/javascript' // 告诉浏览器， 发送的是JavaScript模块，需要你去执行JavaScript的形式去解析这个模块
    ctx.body = stringToStream(code)
  }
  await next()
})

// 2. 修改第三方模块的路径
app.use(async (ctx, next) => {
  console.log(ctx.path, ctx.req['Content-type'])
  // 如果是import 了一个js文件，则content-type是application/javascript
  // 如果ctx上下文中response返回的Content-Type是'application/javascript'， 那么这个中间件就要进行处理了
  if (ctx.type === 'application/javascript') {
    const contents = await streamToString(ctx.body)
    console.log('进来了, ctx.body')
    // console.log(contents) // 返回的是js文件的字符串形式比如<script type="module" src="/src/main.js"></script>， 那么返回的就是读取到/src/main.js内容的字符串形式

    // 对contents进行正则匹配，比如import { createApp } from 'vue', 要将vue匹配到然后替换成node_modules
    // ?! 表示不匹配该分组匹配到的结果
    ctx.body = contents.replace(/(from\s+['"])(?![\.\/])/g, '$1/@modules/').replace(/process\.env\.NODE_ENV/g, '"development"')
    // console.log(ctx.body)
    // 将匹配到结果去node_modules中寻找
  }
})

app.listen(3000)
console.log('server running http://localhost:3000')
