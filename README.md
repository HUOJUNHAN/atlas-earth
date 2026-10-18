# ATLAS 星图

交互世界地图、三维地球与银河系。支持鼠标、触屏与摄像头手势探索。

- [世界地图](https://huojunhan.github.io/atlas-earth/)
- [三维地球](https://huojunhan.github.io/atlas-earth/globe/)
- [银河系](https://huojunhan.github.io/atlas-earth/galaxy/)

558 个地点均有独立中文介绍，涵盖国家首都、中国省会、保山及岛屿地区。三维地球支持真实与粒子两种视图、默认城市连线、城市与地区搜索；银河系支持旋转、缩放、预设视角与星际穿越。

右上角扬声器可开启轻声空间氛围；城市定位、视图切换、流星和星际穿越均有独立音效。首次进入保持静音，手动开启后记住偏好，切到后台自动暂停。声音由 Web Audio 实时合成，无需下载音频或使用第三方音乐。

## 本地预览

安装 Node.js 后运行，无需安装 npm 依赖：

```sh
node scripts/build-pages.mjs
node scripts/check-site.mjs
node scripts/preview.mjs
```

访问 `http://localhost:4180/atlas-earth/`。修改 `dist/` 中的文件后重新运行构建命令。摄像头需要 HTTPS 或 localhost；图像识别在浏览器本机处理。

## 自动部署

推送到 `main` 后，GitHub Actions 构建 `site/` 并部署到 GitHub Pages。构建为项目子路径创建 `/globe/`、`/galaxy/` 入口，无需服务端路由或外部 CDN。

源码位于 `dist/`，生成的 `site/` 不提交到仓库。第三方地理数据、字体、纹理和运行库的来源及许可，见 [NOTICE](dist/assets/NOTICE.txt) 和对应的许可证文件。
