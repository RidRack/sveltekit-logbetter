<script lang="ts">
  let { children } = $props();
</script>

<nav style="display:flex;gap:1rem;margin-bottom:1.5rem;border-bottom:1px solid #ddd;padding-bottom:0.5rem">
  <a href="/">Home</a>
  <a href="/levels">Levels</a>
  <a href="/data">Data</a>
  <a href="/error">Error</a>
</nav>

{@render children()}
