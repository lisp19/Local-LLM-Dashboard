'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Tree, Typography, Space, Spin, message, Row, Col, Progress, Card, Button, Divider, Tooltip, Segmented } from 'antd';
import { HddOutlined, FolderOpenOutlined, FileOutlined, DatabaseOutlined, ReloadOutlined, EllipsisOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

interface DiskOverview {
  system: {
    total: string;
    used: string;
    free: string;
    percent: string;
    mount: string;
  };
  keyDirs: {
    name: string;
    path: string;
    size: string;
    isDir: boolean;
    isKeyNode: boolean;
  }[];
}

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

interface DiskUsageModalProps {
  open: boolean;
  onClose: () => void;
}

const sizeToBytes = (sizeStr: string) => {
  const match = sizeStr.trim().match(/^([0-9.]+)([KMGTP]?)$/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multiplier: Record<string, number> = {
    '': 1, 'K': 1024, 'M': Math.pow(1024, 2), 'G': Math.pow(1024, 3), 'T': Math.pow(1024, 4), 'P': Math.pow(1024, 5),
  };
  return val * (multiplier[unit] || 1);
};

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

export default function DiskUsageModal({ open, onClose }: DiskUsageModalProps) {
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<DiskOverview | null>(null);
  
  const [treeDataPinned, setTreeDataPinned] = useState<TreeNodeData[]>([]);
  const [treeDataRoot, setTreeDataRoot] = useState<TreeNodeData[]>([]);
  const [sortOrder, setSortOrder] = useState<'default' | 'size'>('default');

  const sortedPinned = useMemo(() => sortTree(treeDataPinned, sortOrder), [treeDataPinned, sortOrder]);
  const sortedRoot = useMemo(() => sortTree(treeDataRoot, sortOrder), [treeDataRoot, sortOrder]);

  useEffect(() => {
    if (open && !overview && !loading) {
      loadData(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, overview]);

  const loadData = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const refreshSuffix = forceRefresh ? '&refresh=true' : '';
      const res = await fetch(`/api/disk-usage?action=overview${refreshSuffix}`);
      if (!res.ok) throw new Error('Failed to fetch disk overview');
      const data: DiskOverview = await res.json();
      setOverview(data);

      const pinnedNodes = data.keyDirs.map(dir => ({
        title: (
          <Space>
            <FolderOpenOutlined style={{ color: '#1677ff' }} />
            <Text strong>{dir.name}</Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>({dir.size})</Text>
          </Space>
        ),
        key: dir.path,
        isLeaf: !dir.isDir,
        size: dir.size,
        rawPath: dir.path
      }));
      setTreeDataPinned(pinnedNodes);

      // Fetch root separately to pre-populate bottom tree
      const rootRes = await fetch(`/api/disk-usage?action=tree&path=${encodeURIComponent('/')}${refreshSuffix}`);
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

      setTreeDataRoot([{
        title: (
           <Space>
             <FolderOpenOutlined style={{ color: '#1677ff' }} />
             <Text strong>Root Filesystem (/)</Text>
             <Text type="secondary" style={{ fontSize: '12px' }}>({data.system.used})</Text>
           </Space>
        ),
        key: '/',
        rawPath: '/',
        size: data.system.used,
        isLeaf: false,
        children: rootChildren
      }]);

    } catch (e) {
      console.error(e);
      message.error('Failed to load disk overview');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onLoadData = async (treeSetter: React.Dispatch<React.SetStateAction<TreeNodeData[]>>, { key, children }: any) => {
    if (children) return;
    
    try {
      const res = await fetch(`/api/disk-usage?action=tree&path=${encodeURIComponent(key as string)}`);
      if (!res.ok) throw new Error('Failed to fetch folder contents');
      const data = await res.json();
      
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
    } catch {
      message.error('Permission denied or failed to load folder contents');
    }
  };

  const updateTreeData = (list: TreeNodeData[], key: React.Key, children: TreeNodeData[]): TreeNodeData[] => {
    return list.map((node) => {
      if (node.key === key) {
        return { ...node, children };
      }
      if (node.children) {
        return { ...node, children: updateTreeData(node.children, key, children) };
      }
      return node;
    });
  };

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

  return (
    <Modal
      title={(
        <div className="flex justify-between items-center pr-8 w-full">
          <Space>
            <DatabaseOutlined className="text-blue-500" />
            <span>Disk Usage Explorer</span>
          </Space>
          <Space>
            <Segmented 
              options={[
                { label: 'Default Sort', value: 'default' },
                { label: 'Sort by Size', value: 'size' }
              ]}
              value={sortOrder}
              onChange={(val) => setSortOrder(val as 'default' | 'size')}
              size="small"
            />
            <Tooltip title="Force refresh and recalculate sizes">
              <Button 
                 size="small" 
                 type="text" 
                 icon={<ReloadOutlined />} 
                 onClick={() => loadData(true)} 
                 loading={loading}
                 className="text-slate-500 hover:text-blue-600"
              />
            </Tooltip>
          </Space>
        </div>
      )}
      open={open}
      onCancel={onClose}
      footer={null}
      width={700}
      styles={{ body: { padding: '16px 20px' } }}
    >
      <Spin spinning={loading} tip="Scanning directories...">
        {overview && (
          <div className="mb-6 mt-2">
            <Card size="small" className="bg-slate-50 border-slate-200 shadow-sm rounded-lg mb-4">
              <Row align="middle" gutter={16}>
                <Col flex="48px">
                  <HddOutlined style={{ fontSize: '32px', color: '#1677ff' }} />
                </Col>
                <Col flex="1">
                  <div className="flex justify-between items-center mb-1">
                    <Text strong>System Overview (mount: {overview.system.mount})</Text>
                    <Text type="secondary" className="text-xs">{overview.system.used} / {overview.system.total}</Text>
                  </div>
                  <Progress 
                    percent={parseFloat(overview.system.percent.replace('%', '')) || 0} 
                    strokeColor={{ '0%': '#108ee9', '100%': '#f5222d' }}
                    showInfo={true}
                    format={(p) => `${p}%`}
                  />
                  <div className="text-xs text-slate-500 mt-1">
                    Free Space: {overview.system.free}
                  </div>
                </Col>
              </Row>
            </Card>

            <Title level={5} className="mb-3 text-slate-700">Pinned Directories</Title>
            <div className="border border-slate-200 rounded-lg p-3 bg-white mb-2" style={{ maxHeight: '200px', overflowY: 'auto' }}>
              <Tree
                loadData={(node) => onLoadData(setTreeDataPinned, node)}
                treeData={sortedPinned}
                blockNode
                showLine={{ showLeafIcon: false }}
              />
            </div>
            
            <Divider className="my-4 border-slate-200" />

            <Title level={5} className="mb-3 text-slate-700">System Root Tree</Title>
            <div className="border border-slate-200 rounded-lg p-3 bg-white" style={{ minHeight: '300px', maxHeight: '400px', overflowY: 'auto' }}>
              <Tree
                loadData={(node) => onLoadData(setTreeDataRoot, node)}
                treeData={sortedRoot}
                blockNode
                showLine={{ showLeafIcon: false }}
              />
            </div>

            <div className="mt-4 text-xs text-slate-400">
              Note: The initial view is cached by a background service. Click the refresh icon above to force recalculate folder sizes dynamically.
            </div>
          </div>
        )}
      </Spin>
    </Modal>
  );
}
