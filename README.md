# 《山河摆渡人》剧本站

红色庭院音乐剧《山河摆渡人》官方网站 —— 完整剧本在线读。

## 线上地址

https://zhouyaobai.github.io/shanhe-baiduren/

## 这是一个什么站

六幕完整剧本 + 46 首曲目完整歌词 + 10 位人物 + 6 条伏笔闭环。

- **首页 3D 火塘场景**：Three.js + 手绘钢笔排线着色器（hatching shader），夜、红、墨三色
- **六幕正文**：序幕 / 第一幕 / 第二幕 / 第三幕 / 第四幕 / 尾幕，专业剧本排版（角色名居中、台词缩进、歌词独立行距）
- **曲内有序流**：每首曲目的宣叙调、小节标记、歌词严格按原文顺序呈现
- **曲目总览**：46 首，点开看完整歌词
- **人物卡**：10 位主要角色
- **伏笔闭环**：骨哨、凤凰帕子、银镯、真假油布包、杀父之鞭、夜不渡皎平

## 技术结构

纯静态站点，无构建步骤，无外部依赖（不引用 CDN 字体与图片）。

```
index.html              入口
assets/css/main.css     视觉系统（墨/红/宣纸）
assets/js/data.js       剧本数据层（由 gen_site_data3.py 从 script_struct.json 生成）
assets/js/main.js       页面渲染与交互
assets/js/scene.js      Three.js 3D 火塘场景
assets/js/three.module.js  Three.js 本地副本（1.3MB，为避免 CDN 依赖）
```

## 数据来源

`assets/js/data.js` 由 `gen_site_data3.py` 从专业排版稿的解析结果 `script_struct.json` 映射生成。

**关键约定：不要另写解析器。** `script_struct.json` 由 `extract_script.py` 从
`outputs/《山河摆渡人》剧本定稿（专业排版）.docx` 解析而来，排版稿与网站共用同一份解析结果。
若自行重写 docx 解析，会引入歌词丢失、幕内资料丢失、唱段边界错乱等缺陷。

## 更新剧本后的重建流程

```bash
# 1. 更新 docx → 重新解析出结构
python3 extract_script.py
# 2. 结构 → 网站数据
python3 gen_site_data3.py
# 3. 提交推送
git add -A && git commit -m "update" && git push
```

## 史实与虚构声明

阿木、阿果为艺术虚构人物，原型是千千万万无名彝、汉、傣各族群众。
剧中真实地名、渡口、里程、船工姓名均依史实。
