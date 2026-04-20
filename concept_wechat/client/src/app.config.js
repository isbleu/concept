export default defineAppConfig({
  pages: [
    'pages/watchlist/index',
    'pages/search/index',
    'pages/profile/index',
    'pages/detail/index'
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#0a0a14',
    navigationBarTitleText: '题材库',
    navigationBarTextStyle: 'white'
  },
  tabBar: {
    custom: true,
    color: '#888899',
    selectedColor: '#7C6FFF',
    backgroundColor: '#13131f',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/watchlist/index',
        text: '自选'
      },
      {
        pagePath: 'pages/search/index',
        text: '搜索'
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的'
      }
    ]
  },
  lazyCodeLoading: 'requiredComponents'
})
