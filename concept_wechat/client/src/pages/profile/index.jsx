import React, { useState, useEffect } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text } from '@tarojs/components'
import { getTheme, onThemeChange, toggleTheme, syncPageColors } from '../../utils/theme'
import './index.scss'

const STATS = [
  { label: '关注题材', value: '5' },
  { label: '累计积分', value: '280' },
  { label: '加入天数', value: '12' }
]

const MENU_ITEMS = [
  { icon: '💎', label: '积分明细', desc: '查看积分收支记录' },
  { icon: '🎁', label: '邀请好友', desc: '邀请得积分，共同发掘牛股' },
  { icon: '🔔', label: '提醒设置', desc: '涨跌幅提醒与题材预警' },
  { icon: '📊', label: '使用记录', desc: '我的搜索与浏览历史' },
  { icon: '⚙️', label: '设置', desc: '账号、通知、隐私' }
]

export default function Profile() {
  const [theme, setTheme] = useState(getTheme)

  useEffect(() => {
    return onThemeChange(setTheme)
  }, [])

  useDidShow(() => {
    const t = getTheme()
    Taro.eventCenter.trigger('TAB_CHANGE', 2)
    setTheme(t)
    syncPageColors(t)
  })

  const handleToggle = () => {
    const next = toggleTheme()
    setTheme(next)
  }

  const isDark = theme === 'dark'

  return (
    <View className={`page theme-${theme}`}>
      {/* 顶部英雄卡片 */}
      <View className='hero-card'>
        <View className='hero-bg' />
        <View className='hero-inner'>
          <View className='avatar-wrap'>
            <View className='avatar'>
              <Text className='avatar-emoji'>🧑‍💻</Text>
            </View>
            <View className='avatar-info'>
              <Text className='user-name'>投资玩家 #2048</Text>
              <View className='level-badge'>
                <Text className='level-text'>⭐ 资深探索者</Text>
              </View>
            </View>
          </View>

          <View className='stats-row'>
            {STATS.map((s, i) => (
              <View key={i} className='stat-item'>
                <Text className='stat-value'>{s.value}</Text>
                <Text className='stat-label'>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* 积分进度条 */}
      <View className='points-card'>
        <View className='points-row'>
          <Text className='points-title'>距下一级还需</Text>
          <Text className='points-remain'>220 积分</Text>
        </View>
        <View className='points-track'>
          <View className='points-fill' style={{ width: '56%' }} />
        </View>
        <Text className='points-hint'>每次搜索 +5分 · 邀请好友 +50分</Text>
      </View>

      {/* 主题切换 */}
      <View className='theme-toggle-wrap' onClick={handleToggle}>
        <View className='theme-toggle-left'>
          <Text className='theme-toggle-icon'>{isDark ? '🌙' : '☀️'}</Text>
          <View className='theme-toggle-info'>
            <Text className='theme-toggle-label'>{isDark ? '深色模式' : '浅色模式'}</Text>
            <Text className='theme-toggle-desc'>点击切换显示风格</Text>
          </View>
        </View>
        <View className={`toggle-btn ${isDark ? 'toggle-btn-dark' : 'toggle-btn-light'}`}>
          <View className='toggle-knob' />
        </View>
      </View>

      {/* 菜单列表 */}
      <View className='menu-list' style={{ marginTop: '24rpx' }}>
        {MENU_ITEMS.map((item, i) => (
          <View key={i} className='menu-item'>
            <Text className='menu-icon'>{item.icon}</Text>
            <View className='menu-content'>
              <Text className='menu-label'>{item.label}</Text>
              <Text className='menu-desc'>{item.desc}</Text>
            </View>
            <Text className='menu-arrow'>›</Text>
          </View>
        ))}
      </View>

      <View className='version-area'>
        <Text className='version-text'>题材库 v1.0.0 · 由 AI 驱动</Text>
      </View>
    </View>
  )
}
