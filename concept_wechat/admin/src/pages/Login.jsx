import React from 'react';
import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import axios from 'axios';

const API_BASE = 'http://localhost:5000/api';

export default function Login({ onLoginSuccess }) {
  const onFinish = async (values) => {
    try {
      const res = await axios.post(`${API_BASE}/admin/login`, values);
      if (res.data.success) {
        message.success('登录成功');
        localStorage.setItem('admin_token', res.data.token);
        onLoginSuccess();
      }
    } catch (err) {
      message.error(err.response?.data?.error || '登录失败，请检查账户名及密码');
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh', 
      background: '#f0f2f5' 
    }}>
      <Card title="股票题材大亨 - 管理后台" style={{ width: 400, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        <Form
          name="admin_login"
          initialValues={{ remember: true }}
          onFinish={onFinish}
          layout="vertical"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入管理员账号' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="管理员账号" size="large" />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
              size="large"
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" style={{ width: '100%' }} size="large">
              进入系统
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
