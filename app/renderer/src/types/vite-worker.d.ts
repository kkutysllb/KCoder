/// <reference types="vite/client" />

// Monaco web worker 导入（Vite ?worker 语法）。vite/client 已声明 `*?worker`，
// 此文件显式引用确保 tsconfig types:["node"] 限制下仍可见。
declare module '*?worker' {
  const workerConstructor: {
    new (): Worker
  }
  export default workerConstructor
}
