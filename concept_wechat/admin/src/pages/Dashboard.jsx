import React from 'react';
import { Card, Col, Row, Statistic } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

export default function Dashboard() {
  return (
    <div>
      <h2>运营大盘</h2>
      <Row gutter={16}>
        <Col span={8}>
          <Card bordered={false}>
            <Statistic
              title="平台总用户数"
              value={11}
              precision={0}
              valueStyle={{ color: '#3f8600' }}
              prefix={<ArrowUpOutlined />}
              suffix="人"
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card bordered={false}>
            <Statistic
              title="公共预设题材数"
              value={5}
              precision={0}
              valueStyle={{ color: '#cf1322' }}
              prefix={<ArrowUpOutlined />}
              suffix="个"
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card bordered={false}>
            <Statistic
              title="当日累积搜索 Token 消耗"
              value={1320}
              prefix="$"
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
