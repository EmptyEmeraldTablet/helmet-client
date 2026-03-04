<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getSettings, saveSettings } from '@/utils/settings'
import { testConnection } from '@/api/upload'

const form = reactive(getSettings())
const testing = ref(false)

const handleSave = () => {
  saveSettings({ ...form })
  ElMessage.success('Settings saved')
}

const handleTest = async () => {
  testing.value = true
  const ok = await testConnection(form.serverUrl)
  testing.value = false
  if (ok) {
    ElMessage.success('Server reachable')
  } else {
    ElMessage.error('Connection failed')
  }
}
</script>

<template>
  <section class="panel">
    <div style="margin-bottom: 16px;">
      <div class="panel-title">Connection Settings</div>
      <div class="panel-subtitle">Configure server endpoint and API key.</div>
    </div>

    <el-form label-position="top" style="max-width: 520px;">
      <el-form-item label="Server URL">
        <el-input v-model="form.serverUrl" placeholder="https://example.com" />
      </el-form-item>
      <el-form-item label="API Key">
        <el-input v-model="form.apiKey" type="password" show-password />
      </el-form-item>
      <el-form-item label="Device ID">
        <el-input v-model="form.deviceId" placeholder="device_001" />
      </el-form-item>
      <div style="display: flex; gap: 12px;">
        <el-button type="primary" @click="handleSave">Save</el-button>
        <el-button plain :loading="testing" @click="handleTest">Test Connection</el-button>
      </div>
    </el-form>
  </section>

  <section class="panel">
    <div class="panel-title" style="margin-bottom: 8px;">Notes</div>
    <div class="panel-subtitle">
      Uploads require a valid API key from the admin panel. The test uses `/health`.
    </div>
  </section>
</template>
