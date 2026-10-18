# 参考与素材来源

## Stardew Desk

- 项目：https://github.com/SimoneScoop/Stardew-Desk
- 作者：SimoneScoop
- 代码许可：MIT，完整文本保留在 `licenses/Stardew-Desk-MIT.txt`。
- Stardew Journal 参考该项目的本机素材读取方案、贴图命名与裁剪坐标，以及季节、天气和农场构图。基础农场贴图来自本机已有的 Stardew Desk 缓存；新增的作物、食谱、鱼类、动物、对白与肖像通过本项目的本地提取脚本直接读取已安装游戏。界面、待办数据模型、仓库、厨房和原生 Swift 宿主为本项目实现。

## Stardew Valley

《星露谷物语》（Stardew Valley）的美术、角色、场景、贴图、中文对白、物品与食谱数据等游戏内容 © ConcernedApe。游戏官网：https://www.stardewvalley.net/

Stardew Journal 是非官方桌面待办应用，与 ConcernedApe 无关联，不代表《星露谷物语》官方。

源码仓库和 `Stardew-Journal-source.zip` 不包含提取所得的游戏素材；源码提供本机提取工具，生成内容位于已忽略的 `web/game-assets/`。GitHub Release 的 `Stardew-Journal-macOS-完整版.zip` 则内置应用所需的原版图像、中文对白、物品与食谱数据（包括 `game-data.js`），下载者无需安装游戏或另行提取素材。完整包不包含游戏程序、游戏音乐或个人待办存档。提取过程不修改已安装的游戏文件。

游戏内容的版权仍属于 ConcernedApe；本项目代码及第三方工具的开源许可不适用于这些游戏内容，打包说明与版权标注不表示获得官方授权或背书。

## xnb.js

- 项目：[lybell-art/xnb-js](https://github.com/lybell-art/xnb-js)。
- 本地 XNB 读取工具使用 Lybell 的 **xnb.js 1.2.1**，未经修改的上游源码保存在 `scripts/lib/xnb.cjs`。其文件头注明基于 Leonblade 的 XnbCli。
- 许可：GNU Lesser General Public License 3.0（LGPL-3.0）。完整 LGPL 文本保留在 `scripts/lib/xnb-LICENSE.txt`，其引用的 GNU GPL 3.0 文本保留在 `scripts/lib/xnb-GPL-3.0.txt`。
- 该库随源码以可读的 JavaScript 形式提供，用于本机素材提取；不是游戏美术或游戏程序代码。库的许可与 ConcernedApe 游戏内容的权利分别适用。
- 库内 LZX 解压部分保留了上游的版权与许可声明，涉及 Stuart Caie（2003–2004）、Ali Scissons（2011）、James Stine（2017），以及 LGPL-2.1 和 Microsoft Public License（Ms-PL）声明；详见 `scripts/lib/xnb.cjs` 的 `@license` 段落。
- `scripts/lib/dotnet-metadata.cjs` 和 `scripts/lib/game-readers.cjs` 是本项目实现的只读辅助代码，用于读取已安装游戏程序集的公开数据结构并解析相应 XNB 内容，未复制游戏程序集的实现代码。

## Open-Meteo

天气与地名查询：https://open-meteo.com/ ，天气数据按 CC BY 4.0 使用。应用设置中保留来源链接。
