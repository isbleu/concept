import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import { Layout, Menu, theme, Button } from 'antd';
import { DashboardOutlined, TagsOutlined, UserOutlined, LogoutOutlined, RadarChartOutlined } from '@ant-design/icons';
import Dashboard from './pages/Dashboard';
import ConceptList from './pages/ConceptList';
import Login from './pages/Login';
import DataVisualizer from './pages/DataVisualizer';

const { Header, Content, Footer, Sider } = Layout;

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem('admin_token'));
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    setIsLoggedIn(false);
  };

  // 如果未登录，只渲染登录页面
  if (!isLoggedIn) {
    return <Login onLoginSuccess={() => setIsLoggedIn(true)} />;
  }

  return (
    <BrowserRouter>
      <Layout style={{ minHeight: '100vh' }}>
        <Sider breakpoint="lg" collapsedWidth="0">
          <div className="demo-logo-vertical" style={{ 
            height: 32, 
            margin: 16, 
            color: '#fff', 
            textAlign: 'center', 
            fontWeight: 'bold',
            fontSize: '18px'
          }}>
            VIBE ADMIN
          </div>
          <Menu theme="dark" mode="inline" defaultSelectedKeys={['1']}>
            <Menu.Item key="1" icon={<DashboardOutlined />}>
              <Link to="/">运营大盘</Link>
            </Menu.Item>
            <Menu.Item key="2" icon={<TagsOutlined />}>
              <Link to="/concepts">预设题材库</Link>
            </Menu.Item>
            <Menu.Item key="3" icon={<RadarChartOutlined />}>
              <Link to="/visualizer">数据验证中枢</Link>
            </Menu.Item>
            <Menu.Item key="4" icon={<UserOutlined />}>
              <Link to="/users">用户管理</Link>
            </Menu.Item>
          </Menu>
        </Sider>
        
        <Layout>
          <Header style={{ 
            padding: '0 24px', 
            background: colorBgContainer, 
            display: 'flex', 
            justifyContent: 'flex-end', 
            alignItems: 'center' 
          }}>
            <Button 
              type="text" 
              icon={<LogoutOutlined />} 
              onClick={handleLogout}
            >
              退出登录
            </Button>
          </Header>
          <Content style={{ margin: '24px 16px 0' }}>
            <div style={{ padding: 24, minHeight: 360, background: colorBgContainer, borderRadius: borderRadiusLG }}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/concepts" element={<ConceptList />} />
                <Route path="/visualizer" element={<DataVisualizer />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </Content>
          <Footer style={{ textAlign: 'center' }}>
            股票题材大亨 Admin CMS ©{new Date().getFullYear()}
          </Footer>
        </Layout>
      </Layout>
    </BrowserRouter>
  );
}
