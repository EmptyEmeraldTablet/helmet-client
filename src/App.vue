<template>
  <div class="client-shell">
    <header class="client-header">
      <div class="client-brand">
        <div class="client-brand-title">Helmet<span>Check</span></div>
        <div class="client-brand-sub">现场采集端 · Photo capture & upload</div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="badge">Client</span>
      </div>
    </header>

    <nav class="client-nav">
      <RouterLink to="/">Upload</RouterLink>
      <RouterLink to="/settings">Settings</RouterLink>
    </nav>

    <main class="client-content">
      <RouterView />
    </main>
  </div>
</template>
