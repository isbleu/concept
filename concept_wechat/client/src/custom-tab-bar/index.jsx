import React, { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { View, Text } from '@tarojs/components'
import { getTheme, onThemeChange } from '../utils/theme'
import './index.scss'

const TABS = [
  { path: '/pages/watchlist/index', label: '自选' },
  { path: '/pages/search/index',   label: '搜索' },
  { path: '/pages/profile/index',  label: '我的' }
]

/* 柱状图图标（自选）*/
function IconBars({ active }) {
  const c = active ? '#9B8CFF' : '#55556e'
  return (
    <View className='icon-bars'>
      <View className='bar bar-s' style={{ background: c }} />
      <View className='bar bar-m' style={{ background: c }} />
      <View className='bar bar-l' style={{ background: c }} />
    </View>
  )
}

/* 放大镜图标（搜索）*/
function IconSearch({ active }) {
  const c = active ? '#9B8CFF' : '#55556e'
  return (
    <View className='icon-search'>
      <View className='search-circle' style={{ borderColor: c }} />
      <View className='search-handle' style={{ background: c }} />
    </View>
  )
}

/* 人形图标（我的）*/
function IconProfile({ active }) {
  const c = active ? '#9B8CFF' : '#55556e'
  return (
    <View className='icon-profile'>
      <View className='profile-head' style={{ borderColor: c }} />
      <View className='profile-body' style={{ borderColor: c }} />
    </View>
  )
}

const ICONS = [IconBars, IconSearch, IconProfile]

export default function CustomTabBar() {
  const [selected, setSelected] = useState(0)
  const [theme, setTheme] = useState(getTheme)

  useEffect(() => {
    const handler = (index) => setSelected(index)
    Taro.eventCenter.on('TAB_CHANGE', handler)
    const offTheme = onThemeChange(setTheme)
    return () => {
      Taro.eventCenter.off('TAB_CHANGE', handler)
      offTheme()
    }
  }, [])

  const handleTabClick = (index) => {
    setSelected(index)
    Taro.switchTab({ url: TABS[index].path })
  }

  return (
    <View className={`tabbar theme-${theme}`}>
      <View className='tabbar__divider' />
      <View className='tabbar__inner'>
        {TABS.map((tab, index) => {
          const isActive = selected === index
          const IconComp = ICONS[index]
          return (
            <View
              key={tab.path}
              className='tabbar__item'
              onClick={() => handleTabClick(index)}
            >
              <View className='tabbar__icon'>
                <IconComp active={isActive} />
              </View>
              <Text className={`tabbar__label ${isActive ? 'tabbar__label--active' : ''}`}>
                {tab.label}
              </Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}
