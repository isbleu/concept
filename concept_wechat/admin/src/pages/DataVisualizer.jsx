import React, { useState, useEffect } from 'react';
import { Table, Card, Tag, Space, Typography, Tooltip, Badge } from 'antd';
import { SyncOutlined, RadarChartOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Text } = Typography;
const API_BASE = 'http://localhost:5000/api';

export default function DataVisualizer() {
  const [data, setData] = useState([]);
  const [attributesMap, setAttributesMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [liveQuotes, setLiveQuotes] = useState({});

  useEffect(() => {
    fetchInitialData();
    
    // 监听 SSE 实时波动 (仅行情)
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
        console.error('SSE Error', e);
      }
    };
    return () => sse.close();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      // 并发请求：高频基础与低频战力 Map
      const [quotesRes, attrsRes] = await Promise.all([
        axios.get(`${API_BASE}/market/rpg-master`), // 这里后续可改为更轻量的 /quotes
        axios.get(`${API_BASE}/market/attributes`)
      ]);
      
      if (quotesRes.data.success) setData(quotesRes.data.data);
      if (attrsRes.data.success) setAttributesMap(attrsRes.data.data);
    } catch (err) {
      console.error('Failed to fetch data', err);
    } finally {
      setLoading(false);
    }
  };

  // 辅助函数：从内存 Map 中获取最新战力属性
  const getAttr = (code, field, fallback) => {
    return attributesMap[code]?.[field] ?? fallback;
  };

  const columns = [
    { title: '代码', dataIndex: 'code', key: 'code', width: 80, fixed: 'left' },
    { title: '名称', dataIndex: 'name', key: 'name', width: 90, fixed: 'left' },
    { 
      title: '高频行情(实时)', 
      key: 'market',
      width: 130,
      render: (_, r) => {
        const live = liveQuotes[r.code] || r;
        return (
          <Space direction="vertical" size={0}>
            <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{live.price || '--'}</span>
            <span style={{ color: (live.pct_change || 0) > 0 ? '#ff4d4f' : (live.pct_change || 0) < 0 ? '#52c41a' : 'inherit', fontSize: '12px' }}>
              {live.pct_change > 0 ? `+${live.pct_change}` : live.pct_change}%
            </span>
          </Space>
        );
      }
    },
    { 
      title: '资金与算法信号', 
      key: 'algorithm',
      render: (_, r) => {
        const netMain = getAttr(r.code, 'net_main', r.net_main);
        const mainRatio = getAttr(r.code, 'main_ratio', r.main_ratio);
        const targetPos = getAttr(r.code, 'target_pos', r.target_pos);
        return (
          <Space direction="vertical" size={0}>
            <div>
              <Text type="secondary" style={{ fontSize: '12px' }}>净额: </Text>
              <Text style={{ fontSize: '12px', color: netMain > 0 ? '#ff4d4f' : '#52c41a' }}>
                {netMain != null ? `${netMain}万` : '--'}
              </Text>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: '12px' }}>占比: </Text>
              <Text style={{ fontSize: '12px' }}>{mainRatio != null ? `${mainRatio}%` : '--'}</Text>
            </div>
            <div style={{ marginTop: '4px' }}>
              {targetPos === 1 ? (
                 <Tag color="success">【1】持仓中</Tag>
              ) : targetPos === 0 ? (
                 <Tag color="default">【0】空仓中</Tag>
              ) : (
                 <Tag>等待计算</Tag>
              )}
            </div>
          </Space>
        );
      }
    },
    { 
      title: '体力(VIT)', 
      key: 'VIT',
      sorter: (a, b) => getAttr(a.code, 'VIT', a.VIT) - getAttr(b.code, 'VIT', b.VIT),
      render: (_, r) => {
        const val = getAttr(r.code, 'VIT', r.VIT);
        const pe = getAttr(r.code, 'pe_ttm', r.pe_ttm);
        return (
          <Tooltip title={`估值(1/PE): PE=${pe || '--'}`}>
            <Badge count={val} showZero color={val >= 80 ? '#52c41a' : val <= 20 ? '#ff4d4f' : '#1677ff'} />
          </Tooltip>
        );
      }
    },
    { 
      title: '力量(STR)', 
      key: 'STR',
      sorter: (a, b) => getAttr(a.code, 'STR', a.STR) - getAttr(b.code, 'STR', b.STR),
      render: (_, r) => {
        const val = getAttr(r.code, 'STR', r.STR);
        const dv = getAttr(r.code, 'dv_ttm', r.dv_ttm);
        return (
          <Tooltip title={`股息率: ${dv || '--'}%`}>
            <Badge count={val} showZero color={val >= 80 ? '#eb2f96' : val <= 20 ? '#ff4d4f' : '#1677ff'} />
          </Tooltip>
        );
      }
    },
    { 
      title: '法力(MP)', 
      key: 'MP',
      sorter: (a, b) => getAttr(a.code, 'MP', a.MP) - getAttr(b.code, 'MP', b.MP),
      render: (_, r) => {
        const val = getAttr(r.code, 'MP', r.MP);
        const days = getAttr(r.code, 'up_limit_days', r.up_limit_days);
        return (
          <Tooltip title={`涨停次数 (60日): ${days || 0}次`}>
            <Badge count={val} showZero color={val >= 80 ? '#722ed1' : val <= 20 ? '#ff4d4f' : '#1677ff'} />
          </Tooltip>
        );
      }
    },
    { 
      title: '灵巧(AGI)', 
      key: 'AGI',
      sorter: (a, b) => getAttr(a.code, 'AGI', a.AGI) - getAttr(b.code, 'AGI', b.AGI),
      render: (_, r) => {
        const val = getAttr(r.code, 'AGI', r.AGI);
        const turn = getAttr(r.code, 'turnover_mean', r.turnover_mean);
        return (
          <Tooltip title={`换手均值: ${turn || '--'}%`}>
            <Badge count={val} showZero color={val >= 80 ? '#fa8c16' : val <= 20 ? '#ff4d4f' : '#1677ff'} />
          </Tooltip>
        );
      }
    },
    { 
      title: '智慧(INT)', 
      key: 'INT',
      sorter: (a, b) => getAttr(a.code, 'INT_score', a.INT_score) - getAttr(b.code, 'INT_score', b.INT_score),
      render: (_, r) => {
        const val = getAttr(r.code, 'INT_score', r.INT_score); // 后端存为 INT_score
        const growth = getAttr(r.code, 'profit_growth', r.profit_growth);
        return (
          <Tooltip title={`混合增速: ${growth || '--'}%`}>
            <Badge count={val} showZero color={val >= 80 ? '#13c2c2' : val <= 20 ? '#ff4d4f' : '#1677ff'} />
          </Tooltip>
        );
      }
    },
    {
      title: '更新(RPG)',
      key: 'updated',
      render: (_, r) => {
        const date = getAttr(r.code, 'last_rpg_updated', r.last_rpg_updated);
        return <Text type="secondary" style={{ fontSize: '11px' }}>{date?.split(' ')[1] || '未拉取'}</Text>
      }
    }
  ];

  return (
    <Card 
      title={<><RadarChartOutlined /> 行情数据中枢与 RPG 雷达</>}
      extra={<SyncOutlined spin={loading} onClick={fetchInitialData} style={{ fontSize: '18px', cursor: 'pointer', color: '#1677ff' }} />}
    >
      <Table 
        columns={columns} 
        dataSource={data} 
        loading={loading} 
        rowKey="code"
        scroll={{ x: 1200, y: 600 }}
        pagination={{ pageSize: 50 }}
      />
    </Card>
  );
}

