import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '觅客Agent SeekLead Agent',
    description: '贴上产品链接，从小红书评论区找客户。只读不写，数据本地保存。',
    permissions: ['storage', 'sidePanel', 'scripting', 'activeTab'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    side_panel: {
      default_path: 'sidepanel/index.html',
    },
  },
});
