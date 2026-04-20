import React, { useState, useEffect } from 'react';
import { Table, Space, Button, Tag, Card, Modal, Form, Input, InputNumber, message, Typography, Tabs, Popconfirm } from 'antd';
import { RobotOutlined, PlusOutlined, DeleteOutlined, EditOutlined, UndoOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Text } = Typography;
const { confirm } = Modal;
const API_BASE = 'http://localhost:5000/api';

export default function ConceptList() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('active');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [batchJson, setBatchJson] = useState('');
  const [batchLoading, setBatchLoading] = useState(false);
  const [liveQuotes, setLiveQuotes] = useState({}); // SSE 实时行情缓存
  const [form] = Form.useForm();
  
  const [tempStocks, setTempStocks] = useState([]);

  useEffect(() => {
    fetchConcepts();
  }, [activeTab, searchKeyword]);

  useEffect(() => {
    // 建立 SSE 连接，实时接收单向行情推送
    const sse = new EventSource(`${API_BASE}/market/stream`);
    sse.onmessage = (event) => {
      try {
        const updates = JSON.parse(event.data);
        if (Array.isArray(updates)) {
          setLiveQuotes(prev => {
            const next = { ...prev };
            updates.forEach(q => { next[q.code] = q; });
            return next;
          });
        }
      } catch (e) {
        console.error('SSE parsing error', e);
      }
    };
    return () => sse.close();
  }, []);

  const fetchConcepts = async () => {
    setLoading(true);
    try {
      const url = `${API_BASE}/concepts/admin-list?status=${activeTab}${searchKeyword ? `&keyword=${searchKeyword}` : ''}`;
      const res = await axios.get(url);
      if (res.data.success) {
        setData(res.data.data);
      }
    } catch (err) {
      message.error('获取列表失败');
    } finally {
      setLoading(false);
    }
  };

  const showModal = () => {
    setEditingId(null);
    setIsModalOpen(true);
    form.resetFields();
    setTempStocks([]);
  };

  const handleEdit = (record) => {
    setEditingId(record._id);
    setIsModalOpen(true);
    form.setFieldsValue({
      name: record.name,
      description: record.description,
      hotScore: record.hotScore
    });
    setTempStocks(record.stocks || []);
  };

  const handleStatusUpdate = async (id, status) => {
    try {
      const res = await axios.patch(`${API_BASE}/concepts/${id}/status`, { status });
      if (res.data.success) {
        message.success(status === 'active' ? '题材已重新上架' : '题材已移入回收站');
        fetchConcepts();
      }
    } catch (err) {
      message.error('操作失败');
    }
  };

  const handleDelete = async (id) => {
    try {
      const res = await axios.delete(`${API_BASE}/concepts/${id}`);
      if (res.data.success) {
        message.success('已永久删除');
        fetchConcepts();
      }
    } catch (err) {
      message.error('彻底删除失败');
    }
  };

  // 召唤 AI 生成建议
  const handleAiGenerate = async () => {
    try {
      const values = await form.validateFields(['name', 'count']);
      setAiLoading(true);
      const res = await axios.post(`${API_BASE}/concepts/generate-ai`, {
        keyword: values.name,
        count: values.count || 10
      });
      
      if (res.data.success) {
        setTempStocks(res.data.data.stocks);
        form.setFieldValue('description', res.data.data.description);
        message.success('AI 已成功提炼成分股！');
      }
    } catch (err) {
      message.error(err.response?.data?.error || 'AI 生成失败');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSave = async (isOverwrite = false) => {
    try {
      const values = await form.validateFields();
      if (tempStocks.length === 0) {
        return message.warning('请先生成或添加成分股');
      }

      setLoading(true);
      const res = await axios.post(`${API_BASE}/concepts`, {
        ...values,
        id: editingId,
        stocks: tempStocks,
        type: 'public',
        isOverwrite
      });

      if (res.data.success) {
        message.success(editingId ? '题材修改成功' : '题材录入成功');
        setIsModalOpen(false);
        fetchConcepts();
      } else if (res.data.conflict) {
        // 处理冲突提示
        confirm({
          title: '题材冲突',
          icon: <ExclamationCircleOutlined />,
          content: res.data.message,
          okText: '确认覆盖/恢复',
          cancelText: '取消',
          onOk() {
            handleSave(true);
          },
        });
      }
    } catch (err) {
      message.error('保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBatchImport = async () => {
    try {
      const jsonData = JSON.parse(batchJson);
      setBatchLoading(true);
      const res = await axios.post(`${API_BASE}/concepts/batch`, jsonData);
      if (res.data.success) {
        const { success, skipped, errors } = res.data.data;
        message.success(`导入完成: 成功 ${success}, 跳过 ${skipped}, 失败 ${errors}`);
        setIsBatchModalOpen(false);
        setBatchJson('');
        fetchConcepts();
      }
    } catch (err) {
      message.error('JSON 格式错误或导入失败');
    } finally {
      setBatchLoading(false);
    }
  };

  const removeStock = (code) => {
    setTempStocks(tempStocks.filter(s => s.code !== code));
  };

  const updateStockReason = (code, reason) => {
    setTempStocks(tempStocks.map(s => s.code === code ? { ...s, reason } : s));
  };

  const columns = [
    { title: '题材名称', dataIndex: 'name', key: 'name' },
    { 
      title: '状态', 
      dataIndex: 'status', 
      key: 'status',
      render: (s) => (
        s === 'deleted' ? <Tag color="gray">回收站</Tag> : <Tag color="green">上架中</Tag>
      )
    },
    { title: '热度权重', dataIndex: 'hotScore', key: 'hotScore' },
    { 
      title: '板块均涨幅', 
      key: 'avg_pct_change',
      render: (_, record) => {
        // 实时计算平均涨跌幅，融合 SSE 数据
        let total = 0;
        let count = 0;
        record.stocks?.forEach(s => {
           const live = liveQuotes[s.code];
           if (live && live.pct_change != null) {
              total += live.pct_change;
              count++;
           } else if (s.pct_change != null) {
              total += s.pct_change;
              count++;
           }
        });
        const val = count > 0 ? (total / count).toFixed(2) : 0;
        return (
          <span style={{ color: val > 0 ? '#ff4d4f' : val < 0 ? '#52c41a' : 'inherit', fontWeight: 'bold' }}>
            {val > 0 ? `+${val}` : val}%
          </span>
        );
      }
    },
    { 
      title: '成分股', 
      dataIndex: 'stocks', 
      key: 'stocks',
      render: (s) => (s ? s.length : 0) + ' 只'
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="middle">
          {activeTab === 'active' ? (
            <>
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
              <Popconfirm title="确定要下架该题材吗？它将进入回收站。" onConfirm={() => handleStatusUpdate(record._id, 'deleted')}>
                <Button type="link" danger size="small">下架</Button>
              </Popconfirm>
            </>
          ) : (
            <>
              <Button type="link" size="small" icon={<UndoOutlined />} onClick={() => handleStatusUpdate(record._id, 'active')}>恢复上架</Button>
              <Popconfirm title="确定要彻底删除吗？此操作不可恢复。" onConfirm={() => handleDelete(record._id)}>
                <Button type="link" danger size="small">永久删除</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  const aiColumns = [
    { title: '代码', dataIndex: 'code', key: 'code', width: 80 },
    { title: '名称', dataIndex: 'name', key: 'name', width: 90 },
    { 
      title: '行情(闪烁)', 
      key: 'market', 
      width: 120,
      render: (_, r) => {
        const live = liveQuotes[r.code] || r;
        return (
        <Space direction="vertical" size={0}>
          <span style={{ fontSize: '13px', fontWeight: '500' }}>{live.price || '--'}</span>
          <span style={{ color: live.pct_change > 0 ? '#ff4d4f' : live.pct_change < 0 ? '#52c41a' : 'inherit', fontSize: '12px', fontWeight: 'bold' }}>
            {live.pct_change > 0 ? `+${live.pct_change}` : live.pct_change}%
          </span>
        </Space>
        );
      }
    },
    { 
      title: '高/低/开/昨收', 
      key: 'ohlc', 
      width: 140,
      render: (_, r) => {
        const live = liveQuotes[r.code] || r;
        return (
          <div style={{ fontSize: '11px', display: 'grid', gridTemplateColumns:'1fr 1fr', color: '#888' }}>
             <span>高: {live.high||'--'}</span>
             <span>低: {live.low||'--'}</span>
             <span>开: {live.open||'--'}</span>
             <span>昨: {live.pre_close||'--'}</span>
          </div>
        );
      }
    },
    { 
      title: '量(股)/额(元)', 
      key: 'volamt', 
      width: 130,
      render: (_, r) => {
        const live = liveQuotes[r.code] || r;
        const amt = live.amount ? (live.amount / 100000000).toFixed(2) + '亿' : '--';
        const vol = live.volume ? (live.volume / 1000000).toFixed(2) + '万手' : '--';
        return (
          <Space direction="vertical" size={0} style={{ fontSize: '11px', color: '#888' }}>
             <span>额: {amt}</span>
             <span>量: {vol}</span>
          </Space>
        );
      }
    },
    { 
      title: '入选理由 (可编辑)', 
      dataIndex: 'reason', 
      key: 'reason',
      width: 160,
      render: (text, record) => (
        <Input 
          size="small" 
          value={text} 
          placeholder="请输入入选理由"
          onChange={(e) => updateStockReason(record.code, e.target.value)} 
        />
      )
    },
    { 
      title: '操作',
      key: 'op',
      width: 60,
      fixed: 'right',
      render: (_, record) => (
        <Button 
          type="text" 
          danger 
          icon={<DeleteOutlined />} 
          onClick={() => removeStock(record.code)} 
        />
      )
    }
  ];

  return (
    <Card 
      title="公共题材预置库" 
      extra={
        <Space>
          <Input.Search 
            placeholder="搜索题材名称或描述" 
            onSearch={setSearchKeyword}
            allowClear
            style={{ width: 250 }}
          />
          <Button icon={<PlusOutlined />} onClick={() => setIsBatchModalOpen(true)}>
            批量导入
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => window.open(`${API_BASE}/concepts/export`, '_blank')}>
            导出备份
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={showModal}>
            AI 智能录入
          </Button>
        </Space>
      }
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        { key: 'active', label: '已上架题材' },
        { key: 'deleted', label: '回收站/已下架' }
      ]} />
      
      <Table 
        columns={columns} 
        dataSource={data} 
        loading={loading} 
        rowKey="_id"
      />

      <Modal
        title={editingId ? "编辑题材详情" : "AI 助手：智能提炼题材"}
        open={isModalOpen}
        onOk={() => handleSave(false)}
        onCancel={() => setIsModalOpen(false)}
        width={900}
        okText={editingId ? "保存修改" : "确认入库"}
        cancelText="取消"
        confirmLoading={loading}
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'flex', gap: '16px' }}>
            <Form.Item label="题材关键字" name="name" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="输入题材名，如：星链、固态电池" disabled={!!editingId} />
            </Form.Item>
            {!editingId && (
              <Form.Item label="预计股数" name="count" initialValue={10} style={{ width: '120px' }}>
                <InputNumber min={1} max={30} style={{ width: '100%' }} />
              </Form.Item>
            )}
            <div style={{ paddingTop: !!editingId ? '32px' : '32px' }}>
              <Button 
                type="primary" 
                icon={<RobotOutlined />} 
                onClick={handleAiGenerate}
                loading={aiLoading}
                ghost
              >
                {editingId ? "重新召唤 AI" : "AI 召唤"}
              </Button>
            </div>
          </div>

          <Form.Item label="题材描述 (AI生成后可微调)" name="description">
            <Input.TextArea rows={2} placeholder="AI 会根据题材自动生成背景描述" />
          </Form.Item>
          
          <Form.Item label="预设初始热度" name="hotScore" initialValue={100}>
            <InputNumber min={1} />
          </Form.Item>

          {tempStocks.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <Text strong style={{ marginBottom: '8px', display: 'block' }}>🔬 提炼结果审核：</Text>
              <Table 
                columns={aiColumns} 
                dataSource={tempStocks} 
                pagination={false} 
                size="small" 
                rowKey="code"
                scroll={{ x: 1000, y: 350 }}
              />
            </div>
          )}
        </Form>
      </Modal>

      <Modal
        title="批量导入题材 (JSON 格式)"
        open={isBatchModalOpen}
        onOk={handleBatchImport}
        onCancel={() => setIsBatchModalOpen(false)}
        confirmLoading={batchLoading}
        width={800}
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">请粘贴包含题材对象的 JSON 数组，格式请参考 batch_import.json</Text>
        </div>
        <Input.TextArea 
          rows={15} 
          value={batchJson}
          onChange={e => setBatchJson(e.target.value)}
          placeholder='[{"name": "题材1", "description": "...", "stocks": [...]}, ...]'
        />
      </Modal>
    </Card>
  );
}
