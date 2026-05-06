// vite.config.js
import path from "node:path";
import vue from "file:///home/frappe/frappe-bench/apps/wiki/frontend/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import { defineConfig } from "file:///home/frappe/frappe-bench/apps/wiki/frontend/node_modules/vite/dist/node/index.js";
var __vite_injected_original_dirname = "/home/frappe/frappe-bench/apps/wiki/frontend";
function tiptapShimsPlugin() {
  const shimDir = path.resolve(__vite_injected_original_dirname, "src/lib/tiptap-shims");
  const vue3ShimPath = path.resolve(__vite_injected_original_dirname, "src/lib/tiptap-vue-3-shim.js");
  const tableShimPath = path.resolve(shimDir, "extension-table.js");
  const shimFiles = [
    vue3ShimPath,
    tableShimPath,
    path.resolve(shimDir, "extension-table-cell.js"),
    path.resolve(shimDir, "extension-table-header.js"),
    path.resolve(shimDir, "extension-table-row.js")
  ];
  return {
    name: "tiptap-shims",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source.includes("?original")) {
        const packageName = source.replace("?original", "");
        const resolved = await this.resolve(packageName, importer, {
          ...options,
          skipSelf: true
        });
        return resolved;
      }
      if (importer && shimFiles.includes(importer)) {
        return null;
      }
      if (source === "@tiptap/vue-3") {
        return vue3ShimPath;
      }
      if (source === "@tiptap/extension-table") {
        return tableShimPath;
      }
      return null;
    }
  };
}
async function getFrappeUIPlugin(isDev) {
  if (isDev) {
    try {
      const module2 = await import(path.resolve(__vite_injected_original_dirname, "../../frappe-ui/vite/index.js"));
      return module2.default;
    } catch (error) {
      console.warn(
        "Local frappe-ui not found, falling back to npm package:",
        error.message
      );
      const module2 = await import("file:///home/frappe/frappe-bench/apps/wiki/frontend/node_modules/frappe-ui/vite/index.js");
      return module2.default;
    }
  }
  const module = await import("file:///home/frappe/frappe-bench/apps/wiki/frontend/node_modules/frappe-ui/vite/index.js");
  return module.default;
}
var vite_config_default = defineConfig(async ({ command, mode }) => {
  const isDev = process.env.NODE_ENV !== "production";
  const frappeui = await getFrappeUIPlugin(isDev);
  const config = {
    plugins: [
      tiptapShimsPlugin(),
      frappeui({
        frappeProxy: {
          port: 8080,
          source: "^/(app|login|api|assets|files|private|razorpay_checkout)"
        },
        jinjaBootData: true,
        lucideIcons: true,
        buildConfig: {
          indexHtmlPath: "../wiki/www/wiki.html",
          emptyOutDir: true,
          sourcemap: true
        }
      }),
      vue()
    ],
    build: {
      chunkSizeWarningLimit: 1500,
      outDir: "../wiki/public/frontend",
      emptyOutDir: true,
      target: "es2015",
      sourcemap: true
    },
    resolve: {
      alias: {
        "@": path.resolve(__vite_injected_original_dirname, "src"),
        "tailwind.config.js": path.resolve(__vite_injected_original_dirname, "tailwind.config.js"),
        // Note: @tiptap/vue-3 shimming is handled by tiptapVue3ShimPlugin above
        // Shims for TipTap v3 table extensions (frappe-ui expects default exports)
        "@tiptap/extension-table-cell": path.resolve(
          __vite_injected_original_dirname,
          "src/lib/tiptap-shims/extension-table-cell.js"
        ),
        "@tiptap/extension-table-header": path.resolve(
          __vite_injected_original_dirname,
          "src/lib/tiptap-shims/extension-table-header.js"
        ),
        "@tiptap/extension-table-row": path.resolve(
          __vite_injected_original_dirname,
          "src/lib/tiptap-shims/extension-table-row.js"
        )
      }
    },
    optimizeDeps: {
      include: ["feather-icons", "highlight.js/lib/core", "interactjs"],
      exclude: ["@tiptap/vue-3"]
    },
    server: {
      allowedHosts: true
    }
  };
  if (isDev) {
    try {
      const fs = await import("node:fs");
      const localFrappeUIPath = path.resolve(__vite_injected_original_dirname, "frappe-ui");
      if (fs.existsSync(localFrappeUIPath)) {
        config.resolve.alias["frappe-ui"] = localFrappeUIPath;
      } else {
        console.warn("Local frappe-ui directory not found, using npm package");
      }
    } catch (error) {
      console.warn(
        "Error checking for local frappe-ui, using npm package:",
        error.message
      );
    }
  }
  return config;
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9mcmFwcGUvZnJhcHBlLWJlbmNoL2FwcHMvd2lraS9mcm9udGVuZFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvZnJhcHBlL2ZyYXBwZS1iZW5jaC9hcHBzL3dpa2kvZnJvbnRlbmQvdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL2hvbWUvZnJhcHBlL2ZyYXBwZS1iZW5jaC9hcHBzL3dpa2kvZnJvbnRlbmQvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgcGF0aCBmcm9tICdub2RlOnBhdGgnO1xyXG5pbXBvcnQgdnVlIGZyb20gJ0B2aXRlanMvcGx1Z2luLXZ1ZSc7XHJcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnO1xyXG5cclxuLyoqXHJcbiAqIEN1c3RvbSBwbHVnaW4gdG8gaGFuZGxlIFRpcFRhcCB2MyBzaGltbWluZyBmb3IgZnJhcHBlLXVpIGNvbXBhdGliaWxpdHlcclxuICpcclxuICogUHJvYmxlbXMgc29sdmVkOlxyXG4gKiAxLiBAdGlwdGFwL3Z1ZS0zIG5vIGxvbmdlciBleHBvcnRzIEJ1YmJsZU1lbnUvRmxvYXRpbmdNZW51IChtb3ZlZCB0byAvbWVudXMgc3VicGF0aClcclxuICogMi4gQHRpcHRhcC9leHRlbnNpb24tdGFibGUgbm8gbG9uZ2VyIGhhcyBkZWZhdWx0IGV4cG9ydCAobm93IG5hbWVkIGV4cG9ydClcclxuICpcclxuICogU29sdXRpb246IFVzZSA/b3JpZ2luYWwgc3VmZml4IHRvIGJ5cGFzcyBhbGlhcyBhbmQgcmVzb2x2ZSB0byBhY3R1YWwgbm9kZV9tb2R1bGVzIHBhY2thZ2UuXHJcbiAqL1xyXG5mdW5jdGlvbiB0aXB0YXBTaGltc1BsdWdpbigpIHtcclxuXHRjb25zdCBzaGltRGlyID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9saWIvdGlwdGFwLXNoaW1zJyk7XHJcblx0Y29uc3QgdnVlM1NoaW1QYXRoID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9saWIvdGlwdGFwLXZ1ZS0zLXNoaW0uanMnKTtcclxuXHRjb25zdCB0YWJsZVNoaW1QYXRoID0gcGF0aC5yZXNvbHZlKHNoaW1EaXIsICdleHRlbnNpb24tdGFibGUuanMnKTtcclxuXHJcblx0Ly8gQWxsIHNoaW0gZmlsZXMgdGhhdCBzaG91bGQgYnlwYXNzIHRoZSBhbGlhc2luZ1xyXG5cdGNvbnN0IHNoaW1GaWxlcyA9IFtcclxuXHRcdHZ1ZTNTaGltUGF0aCxcclxuXHRcdHRhYmxlU2hpbVBhdGgsXHJcblx0XHRwYXRoLnJlc29sdmUoc2hpbURpciwgJ2V4dGVuc2lvbi10YWJsZS1jZWxsLmpzJyksXHJcblx0XHRwYXRoLnJlc29sdmUoc2hpbURpciwgJ2V4dGVuc2lvbi10YWJsZS1oZWFkZXIuanMnKSxcclxuXHRcdHBhdGgucmVzb2x2ZShzaGltRGlyLCAnZXh0ZW5zaW9uLXRhYmxlLXJvdy5qcycpLFxyXG5cdF07XHJcblxyXG5cdHJldHVybiB7XHJcblx0XHRuYW1lOiAndGlwdGFwLXNoaW1zJyxcclxuXHRcdGVuZm9yY2U6ICdwcmUnLFxyXG5cdFx0YXN5bmMgcmVzb2x2ZUlkKHNvdXJjZSwgaW1wb3J0ZXIsIG9wdGlvbnMpIHtcclxuXHRcdFx0Ly8gSGFuZGxlID9vcmlnaW5hbCBpbXBvcnRzIC0gYnlwYXNzIGFsaWFzIGFuZCByZXNvbHZlIHRvIG5vZGVfbW9kdWxlc1xyXG5cdFx0XHRpZiAoc291cmNlLmluY2x1ZGVzKCc/b3JpZ2luYWwnKSkge1xyXG5cdFx0XHRcdGNvbnN0IHBhY2thZ2VOYW1lID0gc291cmNlLnJlcGxhY2UoJz9vcmlnaW5hbCcsICcnKTtcclxuXHRcdFx0XHRjb25zdCByZXNvbHZlZCA9IGF3YWl0IHRoaXMucmVzb2x2ZShwYWNrYWdlTmFtZSwgaW1wb3J0ZXIsIHtcclxuXHRcdFx0XHRcdC4uLm9wdGlvbnMsXHJcblx0XHRcdFx0XHRza2lwU2VsZjogdHJ1ZSxcclxuXHRcdFx0XHR9KTtcclxuXHRcdFx0XHRyZXR1cm4gcmVzb2x2ZWQ7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdC8vIERvbid0IGFwcGx5IGFsaWFzZXMgd2hlbiBpbXBvcnRpbmcgZnJvbSBzaGltIGZpbGVzIHRoZW1zZWx2ZXNcclxuXHRcdFx0aWYgKGltcG9ydGVyICYmIHNoaW1GaWxlcy5pbmNsdWRlcyhpbXBvcnRlcikpIHtcclxuXHRcdFx0XHRyZXR1cm4gbnVsbDtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Ly8gQWxpYXMgZXhhY3QgQHRpcHRhcC92dWUtMyB0byBvdXIgc2hpbSAobm90IHN1YnBhdGhzIGxpa2UgL21lbnVzKVxyXG5cdFx0XHRpZiAoc291cmNlID09PSAnQHRpcHRhcC92dWUtMycpIHtcclxuXHRcdFx0XHRyZXR1cm4gdnVlM1NoaW1QYXRoO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBBbGlhcyBAdGlwdGFwL2V4dGVuc2lvbi10YWJsZSB0byBvdXIgc2hpbSAocHJvdmlkZXMgZGVmYXVsdCBleHBvcnQpXHJcblx0XHRcdGlmIChzb3VyY2UgPT09ICdAdGlwdGFwL2V4dGVuc2lvbi10YWJsZScpIHtcclxuXHRcdFx0XHRyZXR1cm4gdGFibGVTaGltUGF0aDtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0cmV0dXJuIG51bGw7XHJcblx0XHR9LFxyXG5cdH07XHJcbn1cclxuXHJcbi8vIENvbmRpdGlvbmFsbHkgaW1wb3J0IGZyYXBwZS11aSBwbHVnaW5cclxuYXN5bmMgZnVuY3Rpb24gZ2V0RnJhcHBlVUlQbHVnaW4oaXNEZXYpIHtcclxuXHRpZiAoaXNEZXYpIHtcclxuXHRcdHRyeSB7XHJcblx0XHRcdGNvbnN0IG1vZHVsZSA9IGF3YWl0IGltcG9ydChcclxuXHRcdFx0XHRwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vZnJhcHBlLXVpL3ZpdGUvaW5kZXguanMnKVxyXG5cdFx0XHQpO1xyXG5cdFx0XHRyZXR1cm4gbW9kdWxlLmRlZmF1bHQ7XHJcblx0XHR9IGNhdGNoIChlcnJvcikge1xyXG5cdFx0XHRjb25zb2xlLndhcm4oXHJcblx0XHRcdFx0J0xvY2FsIGZyYXBwZS11aSBub3QgZm91bmQsIGZhbGxpbmcgYmFjayB0byBucG0gcGFja2FnZTonLFxyXG5cdFx0XHRcdGVycm9yLm1lc3NhZ2UsXHJcblx0XHRcdCk7XHJcblx0XHRcdC8vIEZhbGwgYmFjayB0byBucG0gcGFja2FnZSBpZiBsb2NhbCBpbXBvcnQgZmFpbHNcclxuXHRcdFx0Y29uc3QgbW9kdWxlID0gYXdhaXQgaW1wb3J0KCdmcmFwcGUtdWkvdml0ZScpO1xyXG5cdFx0XHRyZXR1cm4gbW9kdWxlLmRlZmF1bHQ7XHJcblx0XHR9XHJcblx0fVxyXG5cdGNvbnN0IG1vZHVsZSA9IGF3YWl0IGltcG9ydCgnZnJhcHBlLXVpL3ZpdGUnKTtcclxuXHRyZXR1cm4gbW9kdWxlLmRlZmF1bHQ7XHJcbn1cclxuXHJcbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyhhc3luYyAoeyBjb21tYW5kLCBtb2RlIH0pID0+IHtcclxuXHRjb25zdCBpc0RldiA9IHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSAncHJvZHVjdGlvbic7XHJcblx0Y29uc3QgZnJhcHBldWkgPSBhd2FpdCBnZXRGcmFwcGVVSVBsdWdpbihpc0Rldik7XHJcblxyXG5cdGNvbnN0IGNvbmZpZyA9IHtcclxuXHRcdHBsdWdpbnM6IFtcclxuXHRcdFx0dGlwdGFwU2hpbXNQbHVnaW4oKSxcclxuXHRcdFx0ZnJhcHBldWkoe1xyXG5cdFx0XHRcdGZyYXBwZVByb3h5OiB7XHJcblx0XHRcdFx0XHRwb3J0OiA4MDgwLFxyXG5cdFx0XHRcdFx0c291cmNlOiAnXi8oYXBwfGxvZ2lufGFwaXxhc3NldHN8ZmlsZXN8cHJpdmF0ZXxyYXpvcnBheV9jaGVja291dCknLFxyXG5cdFx0XHRcdH0sXHJcblx0XHRcdFx0amluamFCb290RGF0YTogdHJ1ZSxcclxuXHRcdFx0XHRsdWNpZGVJY29uczogdHJ1ZSxcclxuXHRcdFx0XHRidWlsZENvbmZpZzoge1xyXG5cdFx0XHRcdFx0aW5kZXhIdG1sUGF0aDogJy4uL3dpa2kvd3d3L3dpa2kuaHRtbCcsXHJcblx0XHRcdFx0XHRlbXB0eU91dERpcjogdHJ1ZSxcclxuXHRcdFx0XHRcdHNvdXJjZW1hcDogdHJ1ZSxcclxuXHRcdFx0XHR9LFxyXG5cdFx0XHR9KSxcclxuXHRcdFx0dnVlKCksXHJcblx0XHRdLFxyXG5cdFx0YnVpbGQ6IHtcclxuXHRcdFx0Y2h1bmtTaXplV2FybmluZ0xpbWl0OiAxNTAwLFxyXG5cdFx0XHRvdXREaXI6ICcuLi93aWtpL3B1YmxpYy9mcm9udGVuZCcsXHJcblx0XHRcdGVtcHR5T3V0RGlyOiB0cnVlLFxyXG5cdFx0XHR0YXJnZXQ6ICdlczIwMTUnLFxyXG5cdFx0XHRzb3VyY2VtYXA6IHRydWUsXHJcblx0XHR9LFxyXG5cdFx0cmVzb2x2ZToge1xyXG5cdFx0XHRhbGlhczoge1xyXG5cdFx0XHRcdCdAJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ3NyYycpLFxyXG5cdFx0XHRcdCd0YWlsd2luZC5jb25maWcuanMnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAndGFpbHdpbmQuY29uZmlnLmpzJyksXHJcblx0XHRcdFx0Ly8gTm90ZTogQHRpcHRhcC92dWUtMyBzaGltbWluZyBpcyBoYW5kbGVkIGJ5IHRpcHRhcFZ1ZTNTaGltUGx1Z2luIGFib3ZlXHJcblx0XHRcdFx0Ly8gU2hpbXMgZm9yIFRpcFRhcCB2MyB0YWJsZSBleHRlbnNpb25zIChmcmFwcGUtdWkgZXhwZWN0cyBkZWZhdWx0IGV4cG9ydHMpXHJcblx0XHRcdFx0J0B0aXB0YXAvZXh0ZW5zaW9uLXRhYmxlLWNlbGwnOiBwYXRoLnJlc29sdmUoXHJcblx0XHRcdFx0XHRfX2Rpcm5hbWUsXHJcblx0XHRcdFx0XHQnc3JjL2xpYi90aXB0YXAtc2hpbXMvZXh0ZW5zaW9uLXRhYmxlLWNlbGwuanMnLFxyXG5cdFx0XHRcdCksXHJcblx0XHRcdFx0J0B0aXB0YXAvZXh0ZW5zaW9uLXRhYmxlLWhlYWRlcic6IHBhdGgucmVzb2x2ZShcclxuXHRcdFx0XHRcdF9fZGlybmFtZSxcclxuXHRcdFx0XHRcdCdzcmMvbGliL3RpcHRhcC1zaGltcy9leHRlbnNpb24tdGFibGUtaGVhZGVyLmpzJyxcclxuXHRcdFx0XHQpLFxyXG5cdFx0XHRcdCdAdGlwdGFwL2V4dGVuc2lvbi10YWJsZS1yb3cnOiBwYXRoLnJlc29sdmUoXHJcblx0XHRcdFx0XHRfX2Rpcm5hbWUsXHJcblx0XHRcdFx0XHQnc3JjL2xpYi90aXB0YXAtc2hpbXMvZXh0ZW5zaW9uLXRhYmxlLXJvdy5qcycsXHJcblx0XHRcdFx0KSxcclxuXHRcdFx0fSxcclxuXHRcdH0sXHJcblx0XHRvcHRpbWl6ZURlcHM6IHtcclxuXHRcdFx0aW5jbHVkZTogWydmZWF0aGVyLWljb25zJywgJ2hpZ2hsaWdodC5qcy9saWIvY29yZScsICdpbnRlcmFjdGpzJ10sXHJcblx0XHRcdGV4Y2x1ZGU6IFsnQHRpcHRhcC92dWUtMyddLFxyXG5cdFx0fSxcclxuXHRcdHNlcnZlcjoge1xyXG5cdFx0XHRhbGxvd2VkSG9zdHM6IHRydWUsXHJcblx0XHR9LFxyXG5cdH07XHJcblxyXG5cdC8vIEFkZCBsb2NhbCBmcmFwcGUtdWkgYWxpYXMgb25seSBpbiBkZXZlbG9wbWVudCBpZiB0aGUgbG9jYWwgZnJhcHBlLXVpIGV4aXN0c1xyXG5cdGlmIChpc0Rldikge1xyXG5cdFx0dHJ5IHtcclxuXHRcdFx0Ly8gQ2hlY2sgaWYgdGhlIGxvY2FsIGZyYXBwZS11aSBkaXJlY3RvcnkgZXhpc3RzXHJcblx0XHRcdGNvbnN0IGZzID0gYXdhaXQgaW1wb3J0KCdub2RlOmZzJyk7XHJcblx0XHRcdGNvbnN0IGxvY2FsRnJhcHBlVUlQYXRoID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ2ZyYXBwZS11aScpO1xyXG5cdFx0XHRpZiAoZnMuZXhpc3RzU3luYyhsb2NhbEZyYXBwZVVJUGF0aCkpIHtcclxuXHRcdFx0XHRjb25maWcucmVzb2x2ZS5hbGlhc1snZnJhcHBlLXVpJ10gPSBsb2NhbEZyYXBwZVVJUGF0aDtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRjb25zb2xlLndhcm4oJ0xvY2FsIGZyYXBwZS11aSBkaXJlY3Rvcnkgbm90IGZvdW5kLCB1c2luZyBucG0gcGFja2FnZScpO1xyXG5cdFx0XHR9XHJcblx0XHR9IGNhdGNoIChlcnJvcikge1xyXG5cdFx0XHRjb25zb2xlLndhcm4oXHJcblx0XHRcdFx0J0Vycm9yIGNoZWNraW5nIGZvciBsb2NhbCBmcmFwcGUtdWksIHVzaW5nIG5wbSBwYWNrYWdlOicsXHJcblx0XHRcdFx0ZXJyb3IubWVzc2FnZSxcclxuXHRcdFx0KTtcclxuXHRcdH1cclxuXHR9XHJcblxyXG5cdHJldHVybiBjb25maWc7XHJcbn0pO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXNULE9BQU8sVUFBVTtBQUN2VSxPQUFPLFNBQVM7QUFDaEIsU0FBUyxvQkFBb0I7QUFGN0IsSUFBTSxtQ0FBbUM7QUFhekMsU0FBUyxvQkFBb0I7QUFDNUIsUUFBTSxVQUFVLEtBQUssUUFBUSxrQ0FBVyxzQkFBc0I7QUFDOUQsUUFBTSxlQUFlLEtBQUssUUFBUSxrQ0FBVyw4QkFBOEI7QUFDM0UsUUFBTSxnQkFBZ0IsS0FBSyxRQUFRLFNBQVMsb0JBQW9CO0FBR2hFLFFBQU0sWUFBWTtBQUFBLElBQ2pCO0FBQUEsSUFDQTtBQUFBLElBQ0EsS0FBSyxRQUFRLFNBQVMseUJBQXlCO0FBQUEsSUFDL0MsS0FBSyxRQUFRLFNBQVMsMkJBQTJCO0FBQUEsSUFDakQsS0FBSyxRQUFRLFNBQVMsd0JBQXdCO0FBQUEsRUFDL0M7QUFFQSxTQUFPO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixTQUFTO0FBQUEsSUFDVCxNQUFNLFVBQVUsUUFBUSxVQUFVLFNBQVM7QUFFMUMsVUFBSSxPQUFPLFNBQVMsV0FBVyxHQUFHO0FBQ2pDLGNBQU0sY0FBYyxPQUFPLFFBQVEsYUFBYSxFQUFFO0FBQ2xELGNBQU0sV0FBVyxNQUFNLEtBQUssUUFBUSxhQUFhLFVBQVU7QUFBQSxVQUMxRCxHQUFHO0FBQUEsVUFDSCxVQUFVO0FBQUEsUUFDWCxDQUFDO0FBQ0QsZUFBTztBQUFBLE1BQ1I7QUFHQSxVQUFJLFlBQVksVUFBVSxTQUFTLFFBQVEsR0FBRztBQUM3QyxlQUFPO0FBQUEsTUFDUjtBQUdBLFVBQUksV0FBVyxpQkFBaUI7QUFDL0IsZUFBTztBQUFBLE1BQ1I7QUFHQSxVQUFJLFdBQVcsMkJBQTJCO0FBQ3pDLGVBQU87QUFBQSxNQUNSO0FBRUEsYUFBTztBQUFBLElBQ1I7QUFBQSxFQUNEO0FBQ0Q7QUFHQSxlQUFlLGtCQUFrQixPQUFPO0FBQ3ZDLE1BQUksT0FBTztBQUNWLFFBQUk7QUFDSCxZQUFNQSxVQUFTLE1BQU0sT0FDcEIsS0FBSyxRQUFRLGtDQUFXLCtCQUErQjtBQUV4RCxhQUFPQSxRQUFPO0FBQUEsSUFDZixTQUFTLE9BQU87QUFDZixjQUFRO0FBQUEsUUFDUDtBQUFBLFFBQ0EsTUFBTTtBQUFBLE1BQ1A7QUFFQSxZQUFNQSxVQUFTLE1BQU0sT0FBTywwRkFBZ0I7QUFDNUMsYUFBT0EsUUFBTztBQUFBLElBQ2Y7QUFBQSxFQUNEO0FBQ0EsUUFBTSxTQUFTLE1BQU0sT0FBTywwRkFBZ0I7QUFDNUMsU0FBTyxPQUFPO0FBQ2Y7QUFHQSxJQUFPLHNCQUFRLGFBQWEsT0FBTyxFQUFFLFNBQVMsS0FBSyxNQUFNO0FBQ3hELFFBQU0sUUFBUSxRQUFRLElBQUksYUFBYTtBQUN2QyxRQUFNLFdBQVcsTUFBTSxrQkFBa0IsS0FBSztBQUU5QyxRQUFNLFNBQVM7QUFBQSxJQUNkLFNBQVM7QUFBQSxNQUNSLGtCQUFrQjtBQUFBLE1BQ2xCLFNBQVM7QUFBQSxRQUNSLGFBQWE7QUFBQSxVQUNaLE1BQU07QUFBQSxVQUNOLFFBQVE7QUFBQSxRQUNUO0FBQUEsUUFDQSxlQUFlO0FBQUEsUUFDZixhQUFhO0FBQUEsUUFDYixhQUFhO0FBQUEsVUFDWixlQUFlO0FBQUEsVUFDZixhQUFhO0FBQUEsVUFDYixXQUFXO0FBQUEsUUFDWjtBQUFBLE1BQ0QsQ0FBQztBQUFBLE1BQ0QsSUFBSTtBQUFBLElBQ0w7QUFBQSxJQUNBLE9BQU87QUFBQSxNQUNOLHVCQUF1QjtBQUFBLE1BQ3ZCLFFBQVE7QUFBQSxNQUNSLGFBQWE7QUFBQSxNQUNiLFFBQVE7QUFBQSxNQUNSLFdBQVc7QUFBQSxJQUNaO0FBQUEsSUFDQSxTQUFTO0FBQUEsTUFDUixPQUFPO0FBQUEsUUFDTixLQUFLLEtBQUssUUFBUSxrQ0FBVyxLQUFLO0FBQUEsUUFDbEMsc0JBQXNCLEtBQUssUUFBUSxrQ0FBVyxvQkFBb0I7QUFBQTtBQUFBO0FBQUEsUUFHbEUsZ0NBQWdDLEtBQUs7QUFBQSxVQUNwQztBQUFBLFVBQ0E7QUFBQSxRQUNEO0FBQUEsUUFDQSxrQ0FBa0MsS0FBSztBQUFBLFVBQ3RDO0FBQUEsVUFDQTtBQUFBLFFBQ0Q7QUFBQSxRQUNBLCtCQUErQixLQUFLO0FBQUEsVUFDbkM7QUFBQSxVQUNBO0FBQUEsUUFDRDtBQUFBLE1BQ0Q7QUFBQSxJQUNEO0FBQUEsSUFDQSxjQUFjO0FBQUEsTUFDYixTQUFTLENBQUMsaUJBQWlCLHlCQUF5QixZQUFZO0FBQUEsTUFDaEUsU0FBUyxDQUFDLGVBQWU7QUFBQSxJQUMxQjtBQUFBLElBQ0EsUUFBUTtBQUFBLE1BQ1AsY0FBYztBQUFBLElBQ2Y7QUFBQSxFQUNEO0FBR0EsTUFBSSxPQUFPO0FBQ1YsUUFBSTtBQUVILFlBQU0sS0FBSyxNQUFNLE9BQU8sU0FBUztBQUNqQyxZQUFNLG9CQUFvQixLQUFLLFFBQVEsa0NBQVcsV0FBVztBQUM3RCxVQUFJLEdBQUcsV0FBVyxpQkFBaUIsR0FBRztBQUNyQyxlQUFPLFFBQVEsTUFBTSxXQUFXLElBQUk7QUFBQSxNQUNyQyxPQUFPO0FBQ04sZ0JBQVEsS0FBSyx3REFBd0Q7QUFBQSxNQUN0RTtBQUFBLElBQ0QsU0FBUyxPQUFPO0FBQ2YsY0FBUTtBQUFBLFFBQ1A7QUFBQSxRQUNBLE1BQU07QUFBQSxNQUNQO0FBQUEsSUFDRDtBQUFBLEVBQ0Q7QUFFQSxTQUFPO0FBQ1IsQ0FBQzsiLAogICJuYW1lcyI6IFsibW9kdWxlIl0KfQo=
