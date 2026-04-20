import React, { useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import './index.scss'

export default function Index() {
  const [concepts] = useState([
    { id: 1, name: 'SpaceX 概念股', avgIncrease: '+4.25%', isUp: true, hot: 98 },
    { id: 2, name: '固态电池', avgIncrease: '-1.20%', isUp: false, hot: 85 },
    { id: 3, name: '低空经济', avgIncrease: '+5.60%', isUp: true, hot: 120 },
    { id: 4, name: '量子计算', avgIncrease: '+0.88%', isUp: true, hot: 60 }
  ])

  return (
    <View className='container'>
      <View className='header'>
        <Text className='greeting'>早上好，</Text>
        <Text className='title'>发现今日热点题材</Text>
      </View>

      <ScrollView className='concept-list' scrollY>
        {concepts.map(item => (
          <View key={item.id} className='concept-card glass-effect'>
            <View className='card-header'>
              <Text className='concept-name'>{item.name}</Text>
              <View className='hot-badge'>
                <Text className='hot-icon'>🔥</Text>
                <Text className='hot-value'>{item.hot}</Text>
              </View>
            </View>
            <View className='card-body'>
              <Text className='label'>板块平均涨幅</Text>
              <Text className={`increase-value ${item.isUp ? 'text-up' : 'text-down'}`}>
                {item.avgIncrease}
              </Text>
            </View>
            <View className='card-footer'>
              <Text className='action-text'>点击查看成分股与K线</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

