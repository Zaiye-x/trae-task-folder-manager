# SOLO Task Folders

一个用于 TraeCode 的本地 VSIX 扩展，通过文件夹管理 SOLO 任务引用。

## 功能

- 创建任意层级的项目文件夹和全局文件夹
- 在指定文件夹中新建 SOLO 任务
- 将当前 SOLO 任务登记或移动到指定文件夹
- 拖拽移动任务和同区域文件夹
- 重命名、移动和删除文件夹
- 重命名或移除任务引用
- 点击任务直接打开对应 SOLO 对话
- 检查当前 TraeCode 版本的命令兼容性

删除文件夹或任务引用不会删除 TraeCode 中的原始 SOLO 对话。

## 使用

安装并重新加载 TraeCode 后，打开活动栏中的 **SOLO 任务文件夹**：

1. 在“当前项目”或“全局任务”上新建文件夹。
2. 在文件夹上点击 `+`，创建并自动登记一个 SOLO 任务。
3. 在已有 SOLO 对话中使用“将当前任务加入文件夹”。
4. 点击任务名称返回对应对话。

项目目录写入 TraeCode 的 `workspaceState`，全局目录写入
`globalState`。扩展不会读取或修改 TraeCode 的私有数据库。

## 本地开发

```bash
npm install
npm run check
npm test
npm run build
```

按 `F5` 可以在 Extension Development Host 中调试标准 VS Code
能力。TRAE 私有命令需要在 TraeCode 中安装 VSIX 后验证。

## 打包

```bash
npm run vsix
```

产物位于：

```text
dist/trae-task-folder-manager.vsix
```

## 安装

1. 在 TraeCode 中打开“扩展”。
2. 点击右上角 `...`。
3. 选择“从 VSIX 安装”。
4. 选择 `dist/trae-task-folder-manager.vsix`。
5. 重新加载窗口。

也可以使用 TraeCode 自带命令行：

```bash
"/Applications/Trae CN.app/Contents/Resources/app/bin/trae-cn" \
  --install-extension dist/trae-task-folder-manager.vsix --force
```

## 兼容性说明

TraeCode 暂未公开 SOLO 任务管理 API。本扩展在适配层中调用当前版本可用的
内部命令：

- `workbench.action.icube.aiChatSidebar.createNewSession`
- `icube.chat.getCurrentSessionId`
- `workbench.action.chat.openSessionInSidebar`
- `workbench.action.icube.aiChatSidebar.showHistory`

内部命令可能随 TraeCode 升级变化。运行“SOLO 任务文件夹: 检查 TRAE
兼容性”可以查看当前版本的支持情况。直接打开失败时，扩展会复制 Session ID
并打开历史任务列表。

## 边界

标准 VS Code 扩展不能向 `icube-modules-ai-task-panel-v2` 原生任务组件插入
节点，因此文件夹显示在独立的原生 Tree View 中，而不是修改 SOLO 自带任务列表。

活动栏图标基于 Lucide `folder-tree` 图标，按 ISC License 使用。
