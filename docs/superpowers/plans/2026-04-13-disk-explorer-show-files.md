# Disk Explorer 文件展示优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Disk Explorer 各级目录展开时，同时展示子目录和文件，文件按大小降序排列，超过 20 个时折叠并支持点击展开。

**Architecture:** 后端将 `du -hd 1` 改为 `du -ahd 1` 以输出文件条目；前端新增 `buildChildren` 辅助函数，统一处理目录和文件节点，超出 Top 20 的文件以虚拟节点折叠；`sortTree` 更新以保证虚拟节点始终排在末尾。

**Tech Stack:** Next.js 15, React, TypeScript, Ant Design Tree, `du` shell 命令

---

## 涉及文件

| 文件 | 变更类型 | 内容 |
|---|---|---|
| `app/api/disk-usage/route.ts` | Modify | `safeExecDu`：`du -hd 1` → `du -ahd 1` |
| `components/DiskUsageModal.tsx` | Modify | 扩展类型、新增工具函数、重构子节点渲染逻辑 |

---

## Task 1：后端 — 启用 `du -ahd 1` 输出文件条目

**Files:**
- Modify: `app/api/disk-usage/route.ts:57`

- [ ] **Step 1: 修改 `safeExecDu` 中的命令参数**

在 `app/api/disk-usage/route.ts` 中，将第 57 行：

```ts
    const { stdout } = await execFileAsync('du', ['-hd', '1', targetDir]);
```

改为：

```ts
    const { stdout } = await execFileAsync('du', ['-ahd', '1', targetDir]);
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit
```

预期：无错误输出。

- [ ] **Step 3: 提交**

```bash
git add app/api/disk-usage/route.ts
git commit -m "feat: use du -ahd 1 to include files in disk tree output"
```

---

## Task 2：前端 — 类型扩展、工具函数和 `buildChildren`

**Files:**
- Modify: `components/DiskUsageModal.tsx`（类型定义区、工具函数区）

- [ ] **Step 1: 扩展 `TreeNodeData` 接口，新增 `RawChild` 接口，引入 `EllipsisOutlined`**

将文件顶部 import 第 5 行：

```ts
import { HddOutlined, FolderOpenOutlined, FileOutlined, DatabaseOutlined, ReloadOutlined } from '@ant-design/icons';
```

改为：

```ts
import { HddOutlined, FolderOpenOutlined, FileOutlined, DatabaseOutlined, ReloadOutlined, EllipsisOutlined } from '@ant-design/icons';
```

将 `TreeNodeData` 接口（第 26-33 行）改为：

```ts
interface RawChild {
  name: string;
  path: string;
  size: string;
  isDir: boolean;
}

interface TreeNodeData {
  title: React.ReactNode;
  key: string;
  isLeaf?: boolean;
  size: string;
  rawPath: string;
  isExpandMore?: boolean;
  children?: TreeNodeData[];
}
```

- [ ] **Step 2: 更新 `sortTree`，使 `isExpandMore` 虚拟节点始终排在末尾**

将现有 `sortTree` 函数（第 51-67 行）整体替换为：

```ts
const sortTree = (nodes: TreeNodeData[], order: 'default' | 'size'): TreeNodeData[] => {
  const regular = nodes.filter(n => !n.isExpandMore);
  const expandMore = nodes.filter(n => n.isExpandMore);

  const sorted = [...regular].sort((a, b) => {
    if (order === 'size') {
      return sizeToBytes(b.size) - sizeToBytes(a.size);
    } else {
      const aIsDir = a.isLeaf === false;
      const bIsDir = b.isLeaf === false;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return String(a.rawPath || '').localeCompare(String(b.rawPath || ''));
    }
  }).map(node => {
    if (node.children && node.children.length > 0) {
      return { ...node, children: sortTree(node.children, order) };
    }
    return node;
  });

  return [...sorted, ...expandMore];
};
```

- [ ] **Step 3: 在 `updateTreeData` 之后（第 195 行后）插入 `replaceExpandMore` 和 `buildChildren` 两个工具函数**

在 `updateTreeData` 函数结束的 `};`（第 195 行）之后，插入以下代码：

```ts
  const replaceExpandMore = (
    list: TreeNodeData[],
    parentKey: string,
    hiddenNodes: TreeNodeData[]
  ): TreeNodeData[] => {
    return list.map(node => {
      if (node.key === parentKey && node.children) {
        const withoutVirtual = node.children.filter(c => !c.isExpandMore);
        return { ...node, children: [...withoutVirtual, ...hiddenNodes] };
      }
      if (node.children) {
        return { ...node, children: replaceExpandMore(node.children, parentKey, hiddenNodes) };
      }
      return node;
    });
  };

  const FILE_DISPLAY_LIMIT = 20;

  const buildChildren = (
    rawChildren: RawChild[],
    parentPath: string,
    treeSetter: React.Dispatch<React.SetStateAction<TreeNodeData[]>>
  ): TreeNodeData[] => {
    const dirs = rawChildren.filter(c => c.isDir);
    const files = rawChildren.filter(c => !c.isDir);

    const filesSorted = [...files].sort((a, b) => sizeToBytes(b.size) - sizeToBytes(a.size));

    const toNode = (child: RawChild): TreeNodeData => ({
      title: (
        <Space>
          {child.isDir
            ? <FolderOpenOutlined style={{ color: '#fa8c16' }} />
            : <FileOutlined style={{ color: '#8c8c8c' }} />
          }
          <Text>{child.name}</Text>
          <Text type="secondary" style={{ fontSize: '11px' }}>({child.size})</Text>
        </Space>
      ),
      key: child.path,
      rawPath: child.path,
      size: child.size,
      isLeaf: !child.isDir,
    });

    const dirNodes = dirs.map(toNode);
    const visibleFiles = filesSorted.slice(0, FILE_DISPLAY_LIMIT);
    const hiddenFiles = filesSorted.slice(FILE_DISPLAY_LIMIT);
    const visibleFileNodes = visibleFiles.map(toNode);

    const result: TreeNodeData[] = [...dirNodes, ...visibleFileNodes];

    if (hiddenFiles.length > 0) {
      const hiddenFileNodes = hiddenFiles.map(toNode);
      const expandMoreNode: TreeNodeData = {
        title: (
          <Space
            style={{ cursor: 'pointer' }}
            onClick={() => {
              treeSetter(origin => replaceExpandMore(origin, parentPath, hiddenFileNodes));
            }}
          >
            <EllipsisOutlined style={{ color: '#8c8c8c' }} />
            <Text type="secondary" style={{ fontSize: '11px' }}>
              …还有 {hiddenFiles.length} 个文件（点击展开）
            </Text>
          </Space>
        ),
        key: `${parentPath}/__expand_more__`,
        rawPath: parentPath,
        isLeaf: true,
        isExpandMore: true,
        size: '',
      };
      result.push(expandMoreNode);
    }

    return result;
  };
```

注意：`replaceExpandMore`、`FILE_DISPLAY_LIMIT`、`buildChildren` 均定义在组件函数体内，可访问 `sizeToBytes` 等组件外工具函数，以及 `Space`、`Text` 等 JSX。

- [ ] **Step 4: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit
```

预期：无错误输出。

- [ ] **Step 5: 提交**

```bash
git add components/DiskUsageModal.tsx
git commit -m "feat: add buildChildren helper with Top 20 file limit and expand-more node"
```

---

## Task 3：前端 — 在 `loadData` 和 `onLoadData` 中使用 `buildChildren`

**Files:**
- Modify: `components/DiskUsageModal.tsx`（`loadData` 函数、`onLoadData` 函数）

- [ ] **Step 1: 重构 `loadData` 中的 root children 构建逻辑**

在 `loadData` 函数中，将第 113-130 行（root 的子节点构建部分）：

```ts
      let rootChildren: TreeNodeData[] = [];
      if (rootRes.ok) {
        const rootData = await rootRes.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rootChildren = (rootData.children || []).map((child: any) => ({
          title: (
            <Space>
              {child.isDir ? <FolderOpenOutlined style={{ color: '#fa8c16' }} /> : <FileOutlined style={{ color: '#8c8c8c' }} />}
              <Text>{child.name}</Text>
              <Text type="secondary" style={{ fontSize: '11px' }}>({child.size})</Text>
            </Space>
          ),
          key: child.path,
          rawPath: child.path,
          size: child.size,
          isLeaf: !child.isDir
        }));
      }
```

替换为：

```ts
      let rootChildren: TreeNodeData[] = [];
      if (rootRes.ok) {
        const rootData = await rootRes.json();
        rootChildren = buildChildren(rootData.children || [], '/', setTreeDataRoot);
      }
```

- [ ] **Step 2: 重构 `onLoadData` 中的子节点构建逻辑**

在 `onLoadData` 函数中，将第 164-177 行：

```ts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newChildren: TreeNodeData[] = (data.children || []).map((child: any) => ({
        title: (
          <Space>
            {child.isDir ? <FolderOpenOutlined style={{ color: '#fa8c16' }} /> : <FileOutlined style={{ color: '#8c8c8c' }} />}
            <Text>{child.name}</Text>
            <Text type="secondary" style={{ fontSize: '11px' }}>({child.size})</Text>
          </Space>
        ),
        key: child.path,
        rawPath: child.path,
        size: child.size,
        isLeaf: !child.isDir
      }));

      treeSetter(origin => updateTreeData(origin, key, newChildren));
```

替换为：

```ts
      const newChildren: TreeNodeData[] = buildChildren(data.children || [], key as string, treeSetter);
      treeSetter(origin => updateTreeData(origin, key, newChildren));
```

- [ ] **Step 3: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit
```

预期：无错误输出。

- [ ] **Step 4: 手动验证功能**

启动开发服务器：

```bash
npm run dev
```

测试场景：
1. 打开 Disk Explorer，展开一个含有文件和子目录的目录（如 `~`），确认文件和目录均正确展示，目录在前、文件在后
2. 展开一个含有 20+ 个文件的目录，确认"…还有 N 个文件（点击展开）"虚拟节点出现
3. 点击虚拟节点，确认剩余文件正确展开，虚拟节点消失
4. 展开一个只含子目录的目录（如 `/`），确认行为与之前一致
5. 切换 "Sort by Size"，确认虚拟节点始终排在末尾，不参与排序

- [ ] **Step 5: 提交**

```bash
git add components/DiskUsageModal.tsx
git commit -m "feat: integrate buildChildren into loadData and onLoadData for file display"
```
