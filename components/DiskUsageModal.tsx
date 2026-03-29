'use client';

import React, { useState, useEffect } from 'react';
import { Modal, Tree, Typography, Space, Spin, message, Row, Col, Progress, Card, Button, Divider, Tooltip } from 'antd';
import { HddOutlined, FolderOpenOutlined, FileOutlined, DatabaseOutlined, ReloadOutlined } from '@ant-design/icons';

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

interface TreeNodeData {
  title: React.ReactNode;
  key: string;
  isLeaf?: boolean;
  size: string;
  rawPath: string;
  children?: TreeNodeData[];
}

interface DiskUsageModalProps {
  open: boolean;
  onClose: () => void;
}

export default function DiskUsageModal({ open, onClose }: DiskUsageModalProps) {
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<DiskOverview | null>(null);
  
  const [treeDataPinned, setTreeDataPinned] = useState<TreeNodeData[]>([]);
  const [treeDataRoot, setTreeDataRoot] = useState<TreeNodeData[]>([]);

  useEffect(() => {
    if (open && !overview && !loading) {
      loadData(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, overview]);

  const loadData = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const urlSuffix = forceRefresh ? '&refresh=true' : '';
      const res = await fetch(`/api/disk-usage?action=overview${urlSuffix}`);
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
      const rootRes = await fetch(`/api/disk-usage?action=tree&path=/${urlSuffix}`);
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

  return (
    <Modal
      title={(
        <div className="flex justify-between items-center pr-8 w-full">
          <Space>
            <DatabaseOutlined className="text-blue-500" />
            <span>Disk Usage Explorer</span>
          </Space>
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
                treeData={treeDataPinned}
                blockNode
                showLine={{ showLeafIcon: false }}
              />
            </div>
            
            <Divider className="my-4 border-slate-200" />

            <Title level={5} className="mb-3 text-slate-700">System Root Tree</Title>
            <div className="border border-slate-200 rounded-lg p-3 bg-white" style={{ minHeight: '300px', maxHeight: '400px', overflowY: 'auto' }}>
              <Tree
                loadData={(node) => onLoadData(setTreeDataRoot, node)}
                treeData={treeDataRoot}
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
