# Disk Explorer 文件展示优化设计文档

**日期**：2026-04-13  
**分支**：dev  
**状态**：已批准

---

## 背景

当前 Disk Explorer（磁盘探索器）组件在展开目录树时，只展示子目录，不展示目录下的文件。根本原因是后端使用 `du -hd 1 <dir>` 命令，该命令默认只输出目录的磁盘占用，不包含普通文件。前端已有文件渲染逻辑（`FileOutlined` 图标、`isLeaf: true`），但因后端未返回文件数据而未被触发。

---

## 目标

在各级目录展开时，同时展示该目录下的子目录和文件，使 Disk Explorer 真正具备文件浏览能力。

---

## 不在范围内

- 文件内容预览或下载
- 文件/目录删除操作
- 搜索功能
- 配置文件中 `diskPinnedDirs` 的变更

---

## 后端变更

**文件**：`app/api/disk-usage/route.ts`

### `safeExecDu` 函数

将命令从 `du -hd 1` 改为 `du -ahd 1`（增加 `-a` 参数）。

```
du -ahd 1 <targetDir>
```

`-a`（all）使 `du` 输出目录中每个文件条目的大小，而不仅仅是子目录。

### `parseDuOutput` 函数

逻辑基本不变：
- 解析每行 `<size> <path>` 格式
- 跳过与 `targetPath` 相同的行（当前目录自身）
- 使用 `statSync` 判断 `isDir`（已有逻辑）
- 返回统一的 `{ name, path, size, isDir }` 数组

**排序规则**（后端）：目录优先，同类型按文件名字母顺序排列。

**文件数量截断**：由前端负责，后端返回全量数据。

---

## 前端变更

**文件**：`components/DiskUsageModal.tsx`

### `TreeNodeData` 类型扩展

新增可选字段：

```ts
interface TreeNodeData {
  // ...现有字段
  isExpandMore?: boolean;  // 标识"展示更多"虚拟节点
  hiddenFiles?: TreeNodeData[];  // 被折叠的文件节点（存储在父节点或虚拟节点上）
}
```

### 子节点渲染工具函数 `buildChildren`

抽取一个 `buildChildren(rawChildren: RawChild[])` 辅助函数，被 `loadData` 和 `onLoadData` 共同调用：

1. 将 `rawChildren` 分成两组：
   - `dirs`：`isDir === true` 的条目
   - `files`：`isDir === false` 的条目
2. `files` 按大小降序排列（复用现有 `sortTree` 中的字节解析逻辑）
3. 取 `files` 前 20 个为 `visibleFiles`，其余为 `hiddenFiles`
4. 若 `hiddenFiles.length > 0`，在 `visibleFiles` 末尾追加一个"展示更多"虚拟节点：
   ```ts
   {
     title: <Space><EllipsisOutlined /><Text type="secondary">…还有 {hiddenFiles.length} 个文件（点击展开）</Text></Space>,
     key: `${parentPath}/__expand_more__`,
     isLeaf: true,
     isExpandMore: true,
     hiddenFiles: <hidden file nodes>,
     size: '',
     rawPath: parentPath,
   }
   ```
5. 返回 `[...dirNodes, ...visibleFileNodes, ...maybeExpandMoreNode]`

### "展示更多"节点点击处理

在 `Tree` 的 `onSelect` 回调中：
- 检查选中节点是否 `isExpandMore === true`
- 若是，从树状态中定位该节点所在的父节点，将虚拟节点替换为 `hiddenFiles` 中的所有文件节点
- 使用现有的 `updateTreeData` 工具函数更新树状态

### 图标与样式

- 目录节点：`FolderOpenOutlined`（橙色 `#fa8c16`）——现有行为不变
- 文件节点：`FileOutlined`（灰色 `#8c8c8c`）——现有行为，现在实际生效
- 虚拟展开节点：`EllipsisOutlined`（灰色）+ 斜体或次要色文字

### `sortTree` 兼容性

`sortTree` 工具函数在按大小排序时，虚拟节点（`isExpandMore === true`）应始终排在末尾，不参与普通排序。

---

## 数据流

```
用户展开目录
  └→ onLoadData(treeSetter, { key: path })
       └→ GET /api/disk-usage?action=tree&path=<path>
            └→ safeExecDu: du -ahd 1 <path>  ← 新
                 └→ parseDuOutput: 返回 dirs + files
       └→ buildChildren(rawChildren)  ← 新
            └→ dirs (全量) + Top 20 files + 可选虚拟节点
       └→ treeSetter(updateTreeData(...))
```

---

## 测试要点

1. 展开一个含有文件和子目录的目录（如 `~`），确认文件和目录均正确展示
2. 展开一个含有 20+ 个文件的目录，确认"展示更多"虚拟节点出现
3. 点击"展示更多"，确认剩余文件正确展开，虚拟节点消失
4. 展开一个只含子目录的目录（如 `/`），确认行为与现有一致
5. 展开一个只含文件的目录（如 `~/.config/kanban`），确认目录为空、文件正常展示
6. 切换 Sort by Size，确认虚拟节点不参与排序，始终排在末尾
