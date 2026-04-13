'use client';

import { Modal } from 'antd';
import WebShellContent from './WebShellContent';

interface WebShellModalProps {
  open: boolean;
  onClose: () => void;
}

export default function WebShellModal({ open, onClose }: WebShellModalProps) {
  return (
    <Modal
      title={null}
      open={open}
      onCancel={onClose}
      footer={null}
      width={960}
      destroyOnClose
    >
      <WebShellContent mode="modal" />
    </Modal>
  );
}
