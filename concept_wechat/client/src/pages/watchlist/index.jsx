import React, { useState, useEffect } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text, ScrollView } from '@tarojs/components'
import { getTheme, onThemeChange, syncPageColors } from '../../utils/theme'
import './index.scss'

const CONCEPTS = [
  {
    id: 1,
    name: 'SpaceX 概念股',
    avgIncrease: '+4.25%',
    isUp: true,
    hot: 98,
    stocks: ['航天彩虹', '中国卫通', '海格通信'],
    desc: '马斯克星链计划带动低轨卫星产业链爆发',
    gradient: ['#FF6B6B', '#FF8E53']
  },
  {
    id: 2,
    name: '固态电池',
    avgIncrease: '-1.20%',
    isUp: false,
    hot: 85,
    stocks: ['宁德时代', '比亚迪', '赣锋锂业'],
    desc: '下一代电池革命，能量密度提升3倍以上',
    gradient: ['#4ECDC4', '#44A8B3']
  },
  {
    id: 3,
    name: '低空经济',
    avgIncrease: '+5.60%',
    isUp: true,
    hot: 120,
    stocks: ['中信海直', '万丰奥威', '光启技术'],
    desc: '政策大力支持，eVTOL商业化进程加速',
    gradient: ['#9B59B6', '#7C6FFF']
  },
  {
    id: 4,
    name: '量子计算',
    avgIncrease: '+0.88%',
    isUp: true,
    hot: 60,
    stocks: ['国盾量子', '科大国创', '烽火通信'],
    desc: '谷歌、IBM量子霸权争夺引发国内产业关注',
    gradient: ['#3498DB', '#2980B9']
  },
  {
    id: 5,
    name: 'AI芯片国产替代',
    avgIncrease: '+7.33%',
    isUp: true,
    hot: 145,
    stocks: ['寒武纪', '龙芯中科', '景嘉微'],
    desc: '英伟达断供压力下，国产GPU/NPU迎来窗口期',
    gradient: ['#F39C12', '#E67E22']
  }
]

export default function Watchlist() {
  const [theme, setTheme] = useState(getTheme)

  useEffect(() => {
    return onThemeChange(setTheme)
  }, [])

  useDidShow(() => {
    const t = getTheme()
    Taro.eventCenter.trigger('TAB_CHANGE', 0)
    setTheme(t)
    syncPageColors(t)
  })

  const getHotWidth = (hot) => `${Math.min(hot, 150) / 1.5}%`

  const goToDetail = (item) => {
    Taro.navigateTo({
      url: `/pages/detail/index?id=${item.id}&name=${encodeURIComponent(item.name)}&change=${encodeURIComponent(item.avgIncrease)}&isUp=${item.isUp}&hot=${item.hot}`
    })
  }

  return (
    <View className={`page theme-${theme}`}>
      {/* 顶部标题区 */}
      <View className='top-bar'>
        <View className='top-title-group'>
          <Text className='top-label'>我的自选题材</Text>
          <Text className='top-count'>{CONCEPTS.length} 个题材</Text>
        </View>
        <View className='top-date'>
          <Text className='dot dot-live' />
          <Text className='live-text'>实时</Text>
        </View>
      </View>

      <ScrollView className='scroll-area' scrollY>
        {CONCEPTS.map((item) => (
          <View
            key={item.id}
            className='concept-card'
            hoverClass='pressed'
            onClick={() => goToDetail(item)}
          >
            {/* 左侧彩色条 */}
            <View
              className='color-bar'
              style={{ background: `linear-gradient(to bottom, ${item.gradient[0]}, ${item.gradient[1]})` }}
            />

            <View className='card-inner'>
              {/* 顶部行 */}
              <View className='row-top'>
                <Text className='concept-name'>{item.name}</Text>
                <View className={`change-badge ${item.isUp ? 'up' : 'down'}`}>
                  <Text className='change-text'>{item.avgIncrease}</Text>
                </View>
              </View>

              {/* 描述文字 */}
              <Text className='concept-desc'>{item.desc}</Text>

              {/* 成分股列表 */}
              <View className='stock-tags'>
                {item.stocks.map((s, i) => (
                  <View key={i} className='stock-tag'>
                    <Text className='stock-name'>{s}</Text>
                  </View>
                ))}
              </View>

              {/* 底部热度行 */}
              <View className='row-bottom'>
                <View className='hot-bar-wrap'>
                  <View className='hot-bar-track'>
                    <View
                      className='hot-bar-fill'
                      style={{ width: getHotWidth(item.hot) }}
                    />
                  </View>
                  <Text className='hot-label'>热度 {item.hot}</Text>
                </View>
                <Text className='arrow-text'>›</Text>
              </View>
            </View>
          </View>
        ))}
        <View className='bottom-spacer' />
      </ScrollView>
    </View>
  )
}
