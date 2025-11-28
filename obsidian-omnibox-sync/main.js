const obsidian = require('obsidian');

// ============================================================
// 默认设置
// ============================================================

const DEFAULT_SETTINGS = {
  apiKey: '',
  namespaceId: '',
  baseUrl: 'https://www.omnibox.pro',
  upsertPath: '/open/api/v1/resources',
  listPath: '/open/resources/list',
  deletePath: '/open/resources',
  autoSync: false,
  enableFullSync: false,
  syncInterval: 15,
  syncFolder: '',
  remoteTargetId: '',
  includedFolders: [],
  excludedFolders: [],
  preserveHierarchy: true,
  authToken: '',
  useAuthorizationForPatch: true,
  patchAuthHeaderName: '',
  patchAuthHeaderValue: '',
  useCookieTokenForPatch: false,
  loginUrl: '',
  loginUsername: '',
  loginPassword: ''
};

// ============================================================
// Omnibox API 客户端
// ============================================================

class OmniboxClient {
  constructor(baseUrl, apiKey, namespaceId, paths = {}) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.namespaceId = namespaceId;
    this.upsertPath = paths.upsertPath;
    this.listPath = paths.listPath;
    this.deletePath = paths.deletePath;
    this.authToken = paths.authToken;
    this.useAuthorizationForPatch = paths.useAuthorizationForPatch;
    this.patchAuthHeaderName = paths.patchAuthHeaderName;
    this.patchAuthHeaderValue = paths.patchAuthHeaderValue;
    this.useCookieTokenForPatch = paths.useCookieTokenForPatch;
    this.loginUrl = paths.loginUrl || `${baseUrl}/api/v1/login`;
  }

  buildAuthHeaders({ json } = {}) {
    const headers = {};
    if (json) headers['Content-Type'] = 'application/json';
    const bearer = String(this.authToken || this.apiKey || '').trim();
    if (bearer) {
      headers['Authorization'] = `Bearer ${bearer}`;
    }
    if (this.patchAuthHeaderName && this.patchAuthHeaderValue) {
      headers[this.patchAuthHeaderName] = this.patchAuthHeaderValue;
    }
    if (this.useCookieTokenForPatch && bearer) {
      headers['Cookie'] = `token=${bearer}`;
    }
    return headers;
  }

  async loginWithPassword(username, password) {
    const raw = String(this.loginUrl || '').trim();
    const url = /^https?:/i.test(raw) ? raw : `${this.baseUrl}${raw || '/api/v1/login'}`;
    console.log('🔐 尝试登录获取 Token:', { url, username });
    const isEmail = /@/.test(String(username || ''));
    const bodyObj = isEmail ? { email: username, password } : { username, password };
    const resp = await obsidian.requestUrl({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj),
      throw: false
    });
    if (resp.status >= 400) {
      console.error('❌ 登录请求失败:', { status: resp.status, text: resp.text });
      throw new Error(`Login failed: ${resp.status} ${resp.text}`);
    }
    const json = resp.json || {};
    const token = json.token || json.access_token || json.jwt || '';
    if (token) {
      this.authToken = token;
      console.log('✅ 登录成功，已获取 Token');
      return token;
    }
    console.error('❌ 登录响应不包含 Token 字段:', json);
    throw new Error('Login response missing token');
  }

  async getChildren(parentId, options = {}) {
    const url = `${this.baseUrl}/api/v1/namespaces/${this.namespaceId}/resources/${parentId}/children`;
    const headers = this.buildAuthHeaders({ json: false });
    const resp = await obsidian.requestUrl({
      url,
      method: 'GET',
      headers,
      throw: false
    });
    if (resp.status >= 400) {
      throw new Error(`API Error ${resp.status}: ${resp.text}`);
    }
    return resp.json;
  }

  async getRootChildren(options = {}) {
    const url = `${this.baseUrl}/api/v1/namespaces/${this.namespaceId}/root`;
    const headers = this.buildAuthHeaders({ json: false });
    const resp = await obsidian.requestUrl({
      url,
      method: 'GET',
      headers,
      throw: false
    });
    if (resp.status >= 400) {
      throw new Error(`API Error ${resp.status}: ${resp.text}`);
    }
    const json = resp.json || {};
    const children = (json.private && Array.isArray(json.private.children))
      ? json.private.children
      : (Array.isArray(json) ? json : []);
    return children;
  }

  async getNamespaces() {
    const url = `${this.baseUrl}/api/v1/namespaces`;
    const headers = this.buildAuthHeaders({ json: false });
    const resp = await obsidian.requestUrl({
      url,
      method: 'GET',
      headers,
      throw: false
    });
    if (resp.status >= 400) {
      throw new Error(`API Error ${resp.status}: ${resp.text}`);
    }
    return resp.json;
  }

  async createFolder(name, parentId) {
    const url = `${this.baseUrl}/api/v1/namespaces/${this.namespaceId}/resources`;
    const headers = this.buildAuthHeaders({ json: true });
    const resp = await obsidian.requestUrl({
      url,
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        resourceType: 'folder',
        parentId: String(parentId)
      }),
      throw: false
    });
    if (resp.status >= 400) {
      throw new Error(`API Error ${resp.status}: ${resp.text}`);
    }
    return resp.json;
  }

  async getResource(resourceId) {
    const url = `${this.baseUrl}/api/v1/namespaces/${this.namespaceId}/resources/${resourceId}`;
    const headers = {};
    const bearer = String(this.authToken || this.apiKey || '').trim();
    if (this.useAuthorizationForPatch && bearer) {
      headers['Authorization'] = `Bearer ${bearer}`;
    }
    if (this.patchAuthHeaderName && this.patchAuthHeaderValue) {
      headers[this.patchAuthHeaderName] = this.patchAuthHeaderValue;
    }
    if (this.useCookieTokenForPatch && bearer) {
      headers['Cookie'] = `token=${bearer}`;
    }
    const resp = await obsidian.requestUrl({
      url,
      method: 'GET',
      headers,
      throw: false
    });
    return resp;
  }

  async upsertResource(payload) {
    const path = this.upsertPath || '/open/api/v1/resources';
    const url = `${this.baseUrl}${path}`;
    try {
      const targetId = payload.id;
      if (targetId) {
        const patchUrl = `${this.baseUrl}/api/v1/namespaces/${this.namespaceId}/resources/${targetId}`;
        let etag;
        const getResp = await this.getResource(targetId);
        if (getResp.status >= 200 && getResp.status < 300) {
          etag = (getResp.headers && (getResp.headers.etag || getResp.headers['ETag'])) || undefined;
        }
        const headers = { 'Content-Type': 'application/json' };
        const bearer = String(this.authToken || this.apiKey || '').trim();
        if (this.useAuthorizationForPatch && bearer) {
          headers['Authorization'] = `Bearer ${bearer}`;
        }
        if (this.patchAuthHeaderName && this.patchAuthHeaderValue) {
          headers[this.patchAuthHeaderName] = this.patchAuthHeaderValue;
        }
        if (this.useCookieTokenForPatch && bearer) {
          headers['Cookie'] = `token=${bearer}`;
        }
        if (etag) headers['If-Match'] = etag;
        console.log('✏️ 改为 PATCH 更新:', patchUrl);
        const patchBody = {
          namespaceId: this.namespaceId,
          name: payload.name,
          content: payload.content
        };
        console.log('📤 PATCH 请求体:', patchBody);
        const patchResponse = await obsidian.requestUrl({
          url: patchUrl,
          method: 'PATCH',
          headers,
          body: JSON.stringify(patchBody),
          throw: false
        });
        console.log('📥 PATCH 响应状态:', patchResponse.status);
        if (patchResponse.status >= 200 && patchResponse.status < 300) {
          console.log('✅ PATCH 响应成功:', patchResponse.json);
          return patchResponse.json;
        }
        if (patchResponse.status === 401) {
          const authOnlyHeaders = { 'Content-Type': 'application/json' };
          if (this.useAuthorizationForPatch && bearer) {
            authOnlyHeaders['Authorization'] = `Bearer ${bearer}`;
          }
        const patchRetryBody = {
          namespaceId: this.namespaceId,
          name: payload.name,
          content: payload.content
        };
          console.log('📤 PATCH 重试请求体:', patchRetryBody);
          const retryResponse = await obsidian.requestUrl({
            url: patchUrl,
            method: 'PATCH',
            headers: authOnlyHeaders,
            body: JSON.stringify(patchRetryBody),
            throw: false
          });
          console.log('📥 PATCH 重试(仅 Authorization) 状态:', retryResponse.status);
          if (retryResponse.status >= 200 && retryResponse.status < 300) {
            console.log('✅ PATCH 重试成功:', retryResponse.json);
            return retryResponse.json;
          }
          console.error('❌ PATCH 重试错误响应:', retryResponse.text);
        }
        console.error('❌ PATCH API 错误响应:', patchResponse.text);
        throw new Error(`PATCH failed: ${patchResponse.status}`);
      }
      const createUrl = `${this.baseUrl}/api/v1/namespaces/${this.namespaceId}/resources`;
      console.log('🌐 发送 API 请求到:', createUrl);
      console.log('📦 准备上传文件:', payload.name);
      const createBody = {
        name: payload.name,
        resourceType: payload.resourceType,
        parentId: payload.parentId
      };
      console.log('📤 JSON 创建请求体:', createBody);
      const jsonResponse = await obsidian.requestUrl({
        url: createUrl,
        method: 'POST',
        headers: this.buildAuthHeaders({ json: true }),
        body: JSON.stringify(createBody),
        throw: false
      });
      console.log('📥 JSON 响应状态:', jsonResponse.status);
      if (jsonResponse.status >= 200 && jsonResponse.status < 300) {
        console.log('✅ JSON 响应成功:', jsonResponse.json);
        const created = jsonResponse.json || {};
        if (payload.content && created.id) {
          const patchUrl2 = `${this.baseUrl}/api/v1/namespaces/${this.namespaceId}/resources/${created.id}`;
          const headers2 = { 'Content-Type': 'application/json' };
          const bearer2 = String(this.authToken || this.apiKey || '').trim();
          if (this.useAuthorizationForPatch && bearer2) {
            headers2['Authorization'] = `Bearer ${bearer2}`;
          }
          if (this.patchAuthHeaderName && this.patchAuthHeaderValue) {
            headers2[this.patchAuthHeaderName] = this.patchAuthHeaderValue;
          }
          if (this.useCookieTokenForPatch && bearer2) {
            headers2['Cookie'] = `token=${bearer2}`;
          }
          const patchBody2 = {
            namespaceId: this.namespaceId,
            name: payload.name,
            content: payload.content
          };
          console.log('✏️ 创建后 PATCH 更新:', patchUrl2);
          console.log('📤 创建后 PATCH 请求体:', patchBody2);
          const patchResp2 = await obsidian.requestUrl({
            url: patchUrl2,
            method: 'PATCH',
            headers: headers2,
            body: JSON.stringify(patchBody2),
            throw: false
          });
          console.log('📥 创建后 PATCH 状态:', patchResp2.status);
          if (patchResp2.status >= 200 && patchResp2.status < 300) {
            console.log('✅ 创建后 PATCH 成功:', patchResp2.json);
            return patchResp2.json;
          }
          console.error('❌ 创建后 PATCH 错误响应:', patchResp2.text);
        }
        return created;
      }
      console.error('❌ JSON API 错误响应:', jsonResponse.text);
      if (jsonResponse.status === 405 || jsonResponse.status === 404) {
        const fallbackJsonUrl = `${this.baseUrl}/open/api/v1/resources`;
        if (url !== fallbackJsonUrl) {
          console.log('🔁 尝试使用规范端点进行 JSON upsert:', fallbackJsonUrl);
          const fallbackBody = {
            name: payload.name,
            resourceType: payload.resourceType,
            parentId: payload.parentId
          };
          console.log('📤 JSON Fallback 请求体:', fallbackBody);
          const second = await obsidian.requestUrl({
            url: fallbackJsonUrl,
            method: 'POST',
            headers: this.buildAuthHeaders({ json: true }),
            body: JSON.stringify(fallbackBody),
            throw: false
          });
          console.log('📥 JSON Fallback 响应状态:', second.status);
          if (second.status >= 200 && second.status < 300) {
            console.log('✅ JSON Fallback 响应成功:', second.json);
            const created2 = second.json || {};
            if (payload.content && created2.id) {
              const patchUrl3 = `${this.baseUrl}/api/v1/namespaces/${this.namespaceId}/resources/${created2.id}`;
              const headers3 = { 'Content-Type': 'application/json' };
              const bearer3 = String(this.authToken || this.apiKey || '').trim();
              if (this.useAuthorizationForPatch && bearer3) headers3['Authorization'] = `Bearer ${bearer3}`;
              if (this.patchAuthHeaderName && this.patchAuthHeaderValue) headers3[this.patchAuthHeaderName] = this.patchAuthHeaderValue;
              if (this.useCookieTokenForPatch && bearer3) headers3['Cookie'] = `token=${bearer3}`;
              const patchBody3 = {
                namespaceId: this.namespaceId,
                name: payload.name,
                content: payload.content
              };
              console.log('✏️ Fallback 创建后 PATCH 更新:', patchUrl3);
              console.log('📤 Fallback 创建后 PATCH 请求体:', patchBody3);
              const patchResp3 = await obsidian.requestUrl({
                url: patchUrl3,
                method: 'PATCH',
                headers: headers3,
                body: JSON.stringify(patchBody3),
                throw: false
              });
              console.log('📥 Fallback 创建后 PATCH 状态:', patchResp3.status);
              if (patchResp3.status >= 200 && patchResp3.status < 300) {
                console.log('✅ Fallback 创建后 PATCH 成功:', patchResp3.json);
                return patchResp3.json;
              }
              console.error('❌ Fallback 创建后 PATCH 错误响应:', patchResp3.text);
            }
            return created2;
          }
          console.error('❌ JSON Fallback API 错误响应:', second.text);
        }
      }
      const uploadUrl = `${this.baseUrl}/open/api/v1/resources/upload`;
      console.log('🔄 回退到 multipart 上传:', uploadUrl);
      const boundary = '----ObsidianFormBoundary' + Date.now();
      let body = '';
      body += `--${boundary}\r\n`;
      body += `Content-Disposition: form-data; name="file"; filename="${payload.name}.md"\r\n`;
      body += `Content-Type: text/markdown\r\n\r\n`;
      body += payload.content + '\r\n';
      const effectivePath = payload.path || (payload.attrs ? payload.attrs.relative_path : undefined);
      if (effectivePath) {
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="path"\r\n\r\n`;
        body += effectivePath + '\r\n';
      }
      if (payload.parent_id) {
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="parent_id"\r\n\r\n`;
        body += String(payload.parent_id) + '\r\n';
      }
      // 已移除 folder 字段，位置由 parent_id 决定
      if (payload.external_id) {
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="external_id"\r\n\r\n`;
        body += payload.external_id + '\r\n';
      }
      body += `--${boundary}--\r\n`;
      const uploadResponse = await obsidian.requestUrl({
        url: uploadUrl,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: body,
        throw: false
      });
      console.log('📥 Upload 响应状态:', uploadResponse.status);
      if (uploadResponse.status >= 400) {
        console.error('❌ Upload API 错误响应:', uploadResponse.text);
        throw new Error(`API Error ${uploadResponse.status}: ${uploadResponse.text}`);
      }
      console.log('✅ Upload 响应成功:', uploadResponse.json);
      return uploadResponse.json;
    } catch (error) {
      console.error('❌ API 请求失败:', error);
      throw error;
    }
  }

  async listResources(filters = {}) {
    // 🔥 使用配置的路径或默认路径
    const path = this.listPath || '/v1/resources/list';
    const url = `${this.baseUrl}${path}`;
    
    try {
      console.log('🔍 列出资源 - URL:', url);
      
      const response = await obsidian.requestUrl({
        url: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(filters),
        throw: false
      });

      console.log('📥 List 响应状态:', response.status);
      
      if (response.status >= 400) {
        console.error('❌ List API 错误:', response.text);
        throw new Error(`API Error ${response.status}: ${response.text}`);
      }

      return response.json;
    } catch (error) {
      console.error('❌ List API 请求失败:', error);
      throw error;
    }
  }

  // 🔥 新增：简单的 GET 测试方法
  async testConnection() {
    try {
      // 尝试最简单的 GET 请求测试连接
      const testUrl = `${this.baseUrl}/health`;
      console.log('🏥 测试健康检查端点:', testUrl);
      
      const response = await obsidian.requestUrl({
        url: testUrl,
        method: 'GET',
        throw: false
      });
      
      console.log('Health check 响应:', response.status, response.text);
      return { success: true, status: response.status };
    } catch (error) {
      console.error('Health check 失败:', error);
      
      // 如果健康检查失败，尝试 list 端点
      console.log('🔄 尝试 list 端点...');
      return await this.listResources({ limit: 1 });
    }
  }

  async deleteResource(resourceId) {
    const url = `${this.baseUrl}/v1/resources/${resourceId}`;
    
    try {
      const response = await obsidian.requestUrl({
        url: url,
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        throw: false
      });

      if (response.status >= 400) {
        throw new Error(`API Error ${response.status}: ${response.text}`);
      }

      return true;
    } catch (error) {
      console.error('API 请求失败:', error);
      throw error;
    }
  }
}

// ============================================================
// 同步缓存类
// ============================================================

class SyncCache {
  constructor() {
    this.idToEntry = new Map();
    this.pathToId = new Map();
  }
  
  set(id, entry) {
    this.idToEntry.set(id, entry);
    if (entry.localPath) {
      this.pathToId.set(entry.localPath, id);
    }
  }
  
  getById(id) {
    return this.idToEntry.get(id);
  }
  
  getByPath(path) {
    const id = this.pathToId.get(path);
    return id ? this.idToEntry.get(id) : null;
  }
  
  getIdByPath(path) {
    return this.pathToId.get(path);
  }
  
  delete(id) {
    const entry = this.idToEntry.get(id);
    if (entry?.localPath) {
      this.pathToId.delete(entry.localPath);
    }
    this.idToEntry.delete(id);
  }
  
  size() {
    return this.idToEntry.size;
  }
  
  clear() {
    this.idToEntry.clear();
    this.pathToId.clear();
  }
  
  save() {
    return Array.from(this.idToEntry.entries()).map(([id, entry]) => ({
      id,
      ...entry
    }));
  }
  
  load(data) {
    if (!Array.isArray(data)) return;
    data.forEach(entry => {
      if (entry.id) {
        this.set(entry.id, entry);
      }
    });
  }
  
  getAllPaths() {
    return Array.from(this.pathToId.keys());
  }
  
  getAllIds() {
    return Array.from(this.idToEntry.keys());
  }
}

// ============================================================
// 同步引擎
// ============================================================

class SyncEngine {
  constructor(client, vault, cache, plugin) {
    this.client = client;
    this.vault = vault;
    this.cache = cache;
    this.plugin = plugin;
    this.inFlightPaths = new Set();
  }

  detectResourceType(path) {
    const p = String(path || '').toLowerCase();
    if (p.endsWith('.md')) return 'doc';
    return 'doc';
  }
  
  normalizePath(path) {
    if (!path) return '';
    return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }
  
  hashContent(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
  
  // 🔥 缓存持久化方法
  async persistCache() {
    if (!this.plugin) {
      console.warn("⚠️ 无法保存缓存：plugin 实例不存在");
      return;
    }
    
    try {
      const currentData = await this.plugin.loadData() || {};
      await this.plugin.saveData({
        ...currentData,
        syncCache: this.cache.save()
      });
      console.log("💾 缓存已保存到磁盘");
    } catch (error) {
      console.error("❌ 缓存保存失败:", error);
    }
  }
  
  // 🔥 修复后的 syncFile 方法
  async syncFile(file) {
    const p = this.normalizePath(file.path);
    
    // 检查是否已在同步队列
    if (this.inFlightPaths.has(p)) {
      console.log(`🔒 已在同步队列: ${p}`);
      return;
    }
    
    try {
      // 立即锁定路径
      this.inFlightPaths.add(p);
      console.log(`🔒 锁定路径: ${p}`);
      
      const content = await this.vault.read(file);
      const cached = this.cache.getByPath(p);
      const currentHash = this.hashContent(content);
      const now = Date.now();
      
      // 节流检查：10秒内相同内容不重复上传
      const lastSync = cached?.lastSyncTime || 0;
      if (cached && cached.contentHash === currentHash && now - lastSync < 10000) {
        console.log(`⏸️ 节流跳过: ${p} (距上次同步 ${Math.round((now - lastSync)/1000)}s)`);
        return;
      }
      
      // 内容未变化检查
      if (cached && cached.contentHash === currentHash) {
        console.log(`⏭️ 内容未变: ${p}`);
        return;
      }
      
      // 准备上传参数
      const settings = this.plugin?.settings || {};
      const targetFolder = undefined;
      const parentId = (settings.remoteTargetId || '').trim() || undefined;
      if (!parentId) {
        new obsidian.Notice('请在设置中选择远端目标节点');
        return;
      }
      const preserveHierarchy = settings.preserveHierarchy !== false;
      const base = this.normalizePath(settings.syncFolder || '');
      
      let relativePath = preserveHierarchy ? p : file.basename;
      if (preserveHierarchy && base) {
      const withSlash = base.endsWith('/') ? base : (base + '/');
      if (relativePath === base) {
        relativePath = file.basename;
      } else if (relativePath.startsWith(withSlash)) {
        relativePath = relativePath.slice(withSlash.length);
      } else if (relativePath.startsWith(base)) {
        relativePath = relativePath.slice(base.length);
        relativePath = relativePath.replace(/^\/+/, '');
      }
    }
      relativePath = this.normalizePath(relativePath);
      if (typeof relativePath.normalize === "function") {
        relativePath = relativePath.normalize("NFC");
      }
      
      const name = file.basename;
      const stableName = (typeof name.normalize === "function") 
        ? name.normalize("NFC") 
        : name;
      
      // 获取已存在的 ID
      const existingId = cached?.id || this.cache.getIdByPath(p);
      
      console.log(`📤 准备上传: ${p}`);
      console.log(`   - 相对路径: ${relativePath}`);
      console.log(`   - 已存在ID: ${existingId || 'none'}`);
      console.log(`   - External ID: ${p}`);
      console.log(`   - Content Hash: ${currentHash}`);
      
    // 构建 API 请求负载
    const payload = {
      name: stableName,
      content,
      namespaceId: this.plugin?.settings?.namespaceId,
      resourceType: this.detectResourceType(relativePath),
      parentId: String(parentId),
      path: relativePath,
      attrs: {
        relative_path: relativePath
      },
      external_id: p,
      skip_parsing_tags_from_content: false
    };
    
    // 如果有已存在的ID，包含它以确保是更新而不是创建
    if (existingId) {
      payload.id = existingId;
    }
      
      console.log(`🌐 API 请求:`, {
        hasId: !!payload.id,
        id: payload.id,
        external_id: payload.external_id,
        name: payload.name
      });
      
      // 调用 API
    // 若保留层级，则确保父目录在远端存在（按相对路径的上一层）
    if (preserveHierarchy) {
      const parts = relativePath.split('/');
      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join('/');
        const ensuredParentId = await this.ensureFolder(parentPath, String(parentId));
        payload.parentId = String(ensuredParentId);
      }
    }
    const result = await this.client.upsertResource(payload);
      
      console.log(`📥 API 响应:`, {
        returned_id: result.id,
        sent_id: payload.id,
        id_changed: existingId && existingId !== result.id
      });
      
      // 检测 ID 变更（这不应该发生）
      if (existingId && existingId !== result.id) {
        console.warn(`⚠️ 检测到路径 ${p} 的 ID 变更: ${existingId} -> ${result.id}`);
      }
      
      // 更新内存缓存
      this.cache.set(result.id, {
        id: result.id,
        localPath: p,
        remotePath: relativePath,
        contentHash: currentHash,
        lastSyncTime: now
      });
      
      console.log(`✅ 同步成功: ${file.path} -> ${result.id}`);
      
      // 🔥 关键修复：立即持久化缓存到磁盘
      await this.persistCache();
      
    } catch (error) {
      const msg = String(error?.message || error || "");
      
      if (/\b401\b/.test(msg)) {
        new obsidian.Notice("认证失败 - 请检查 API Key、Namespace ID 和 API URL");
      }
      
      console.error(`❌ 同步失败: ${file.path}`, error);
      throw error;
      
    } finally {
      // 总是释放锁
      this.inFlightPaths.delete(p);
      console.log(`🔓 释放锁: ${p}`);
    }
  }
  
  async syncFolder(folder) {
    const p = this.normalizePath(folder.path);
    const settings = this.plugin?.settings || {};
    const parentId = (settings.remoteTargetId || '').trim() || undefined;
    const preserveHierarchy = settings.preserveHierarchy !== false;
    const base = this.normalizePath(settings.syncFolder || '');
    if (!parentId) {
      new obsidian.Notice('请在设置中选择远端目标节点');
      return;
    }
    let relativePath = preserveHierarchy ? p : folder.name;
    if (preserveHierarchy && base) {
      const withSlash = base.endsWith('/') ? base : (base + '/');
      if (relativePath === base) {
        relativePath = folder.name;
      } else if (relativePath.startsWith(withSlash)) {
        relativePath = relativePath.slice(withSlash.length);
      } else if (relativePath.startsWith(base)) {
        relativePath = relativePath.slice(base.length);
        relativePath = relativePath.replace(/^\/+/, '');
      }
    }
    relativePath = this.normalizePath(relativePath);
    if (typeof relativePath.normalize === 'function') {
      relativePath = relativePath.normalize('NFC');
    }
    const ensuredId = await this.ensureFolder(relativePath, parentId);
    this.cache.set(ensuredId, {
      id: ensuredId,
      localPath: p,
      remotePath: relativePath,
      contentHash: '',
      lastSyncTime: Date.now()
    });
    await this.persistCache();
    console.log(`📁 目录同步完成: ${p} -> ${ensuredId}`);
  }
  
  async syncAllFiles(files) {
    const results = {
      success: 0,
      skipped: 0,
      failed: 0
    };
    
    for (const file of files) {
      try {
        await this.syncFile(file);
        results.success++;
      } catch (error) {
        console.error(`同步失败: ${file.path}`, error);
        results.failed++;
      }
    }
    
    return results;
  }

  async ensureFolder(path, parentId) {
    if (!parentId || typeof parentId !== 'string' || parentId.trim() === '') {
      throw new Error('缺少父级 ID');
    }
    const segs = path.split('/').filter(Boolean);
    if (segs.length === 0) return parentId;
    let currentParentId = parentId;
    let currentPath = '';
    const base = this.normalizePath(this.plugin?.settings?.syncFolder || '');
    for (const seg of segs) {
      currentPath = currentPath ? `${currentPath}/${seg}` : seg;
      const localPathKey = base ? `${base}${currentPath ? '/' : ''}${currentPath}` : currentPath;
      const existing = this.cache.getByPath(localPathKey);
      if (existing?.id) {
        currentParentId = existing.id;
        continue;
      }
      const created = await this.client.createFolder(seg, currentParentId);
      const folderId = String(created.id);
      this.cache.set(folderId, {
        id: folderId,
        localPath: localPathKey,
        remotePath: seg,
        contentHash: '',
        lastSyncTime: Date.now()
      });
      await this.persistCache();
      currentParentId = folderId;
    }
    return currentParentId;
  }
}

class NodePickerModal extends obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.client = plugin.getSharedClient();
    this.currentId = '';
    this.breadcrumbs = [{ id: '', name: '根空间' }];
  }
  async onOpen() {
    this.containerEl.empty();
    const header = this.containerEl.createEl('div');
    const bc = this.containerEl.createEl('div');
    const list = this.containerEl.createEl('div');
    const footer = this.containerEl.createEl('div');
    const renderBreadcrumbs = () => {
      bc.empty();
      for (let i = 0; i < this.breadcrumbs.length; i++) {
        const crumb = this.breadcrumbs[i];
        const span = bc.createEl('span', { text: crumb.name });
        span.style.cursor = 'pointer';
        span.onclick = async () => {
          this.breadcrumbs = this.breadcrumbs.slice(0, i + 1);
          this.currentId = crumb.id;
          await this.loadChildrenInto(list);
        };
        if (i < this.breadcrumbs.length - 1) bc.createEl('span', { text: ' / ' });
      }
    };
    const renderList = (items) => {
      list.empty();
      if (Array.isArray(items)) {
        for (const item of items) {
          const row = list.createEl('div');
          const typeLabel = item.resource_type || item.type || 'unknown';
          const nameLabel = (item.name && item.name.trim().length > 0) ? item.name : (item.title || item.id);
          row.createEl('span', { text: `${nameLabel} (${typeLabel})` });
          const selectBtn = row.createEl('button', { text: '选择' });
          selectBtn.onclick = async () => {
            this.plugin.settings.remoteTargetId = String(item.id);
            await this.plugin.saveSettings();
            new obsidian.Notice(`已选择父节点: ${nameLabel}`);
            this.close();
          };
          const openBtn = row.createEl('button', { text: '打开' });
          openBtn.onclick = async () => {
            this.currentId = String(item.id);
            this.breadcrumbs.push({ id: this.currentId, name: nameLabel });
            await this.loadChildrenInto(list);
            renderBreadcrumbs();
          };
        }
      }
    };
    const selectCurrentBtn = footer.createEl('button', { text: '选择当前节点' });
    selectCurrentBtn.onclick = async () => {
      this.plugin.settings.remoteTargetId = this.currentId || '';
      await this.plugin.saveSettings();
      const name = this.breadcrumbs[this.breadcrumbs.length - 1]?.name || '根空间';
      new obsidian.Notice(`已选择父节点: ${name}`);
      this.close();
    };
    await this.loadChildrenInto(list);
    renderBreadcrumbs();
  }
  async loadChildrenInto(container) {
    try {
      if (!this.currentId) {
        const items = await this.client.getRootChildren();
        const render = (itemsArr) => {
          container.empty();
          if (Array.isArray(itemsArr)) {
            for (const item of itemsArr) {
              if ((item.resource_type || item.type) !== 'folder') continue;
              const row = container.createEl('div');
              const typeLabel = item.resource_type || item.type || 'unknown';
              const nameLabel = (item.name && item.name.trim().length > 0) ? item.name : (item.title || item.id);
              row.createEl('span', { text: `${nameLabel} (${typeLabel})` });
              const selectBtn = row.createEl('button', { text: '选择' });
              selectBtn.onclick = async () => {
                this.plugin.settings.remoteTargetId = String(item.id);
                await this.plugin.saveSettings();
                new obsidian.Notice(`已选择父节点: ${nameLabel}`);
                this.close();
              };
              const openBtn = row.createEl('button', { text: '打开' });
              openBtn.onclick = async () => {
                this.currentId = String(item.id);
                this.breadcrumbs.push({ id: this.currentId, name: nameLabel });
                await this.loadChildrenInto(container);
              };
            }
          }
        };
        render(items);
      } else {
        const children = await this.client.getChildren(this.currentId);
        container.empty();
        if (Array.isArray(children)) {
          for (const item of children) {
            if ((item.resource_type || item.type) !== 'folder') continue;
            const row = container.createEl('div');
            const typeLabel = item.resource_type || item.type || 'unknown';
            const nameLabel = (item.name && item.name.trim().length > 0) ? item.name : (item.title || item.id);
            row.createEl('span', { text: `${nameLabel} (${typeLabel})` });
            const selectBtn = row.createEl('button', { text: '选择' });
            selectBtn.onclick = async () => {
              this.plugin.settings.remoteTargetId = String(item.id);
              await this.plugin.saveSettings();
              new obsidian.Notice(`已选择父节点: ${nameLabel}`);
              this.close();
            };
            const openBtn = row.createEl('button', { text: '打开' });
            openBtn.onclick = async () => {
              this.currentId = String(item.id);
              this.breadcrumbs.push({ id: this.currentId, name: nameLabel });
              await this.loadChildrenInto(container);
            };
          }
        }
      }
    } catch (e) {
      new obsidian.Notice('加载节点失败');
    }
  }
}

// ============================================================
// 设置面板
// ============================================================

class OmniboxSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Omnibox 同步设置' });

    // API Key
    new obsidian.Setting(containerEl)
      .setName('API Key')
      .setDesc('你的 Omnibox API Key')
      .addText(text => text
        .setPlaceholder('输入 API Key')
        .setValue(this.plugin.settings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value;
          await this.plugin.saveSettings();
        }));

    // Namespace ID
    new obsidian.Setting(containerEl)
      .setName('Namespace ID')
      .setDesc('从服务端动态获取命名空间列表，选择用于同步的空间')
      .addDropdown((dropdown) => {
        dropdown.addOption('', '请选择命名空间');
        const client = this.plugin.getSharedClient();
        client.getNamespaces()
          .then((list) => {
            if (Array.isArray(list)) {
              for (const ns of list) {
                const id = String(ns.id || '');
                const name = String(ns.name || id);
                dropdown.addOption(id, name);
              }
            }
            dropdown.setValue(String(this.plugin.settings.namespaceId || ''));
          })
          .catch((e) => {
            console.error('加载命名空间失败:', e);
            new obsidian.Notice('加载命名空间失败，请检查认证与接口');
          });
        dropdown.onChange(async (value) => {
          this.plugin.settings.namespaceId = String(value || '').trim();
          await this.plugin.saveSettings();
          this.plugin.sharedClient = null;
        });
      });

    // API URL
    new obsidian.Setting(containerEl)
      .setName('API URL')
      .setDesc('Omnibox API 地址')
      .addText(text => text
        .setPlaceholder('https://api.omnibox.com')
        .setValue(this.plugin.settings.baseUrl)
        .onChange(async (value) => {
          this.plugin.settings.baseUrl = value;
          await this.plugin.saveSettings();
          this.plugin.sharedClient = null; // 重置客户端
        }));

    // 🔥 新增：API 路径配置
    containerEl.createEl('h3', { text: 'API 端点配置（高级）' });
    containerEl.createEl('p', { 
      text: '如果默认路径不正确，可以自定义 API 端点路径',
      cls: 'setting-item-description'
    });

    new obsidian.Setting(containerEl)
      .setName('Upsert 路径')
      .setDesc('创建/更新资源的 API 路径')
      .addText(text => text
        .setPlaceholder('/open/api/v1/resources')
        .setValue(this.plugin.settings.upsertPath || '/open/api/v1/resources')
        .onChange(async (value) => {
          this.plugin.settings.upsertPath = value;
          await this.plugin.saveSettings();
          this.plugin.sharedClient = null;
        }));

    new obsidian.Setting(containerEl)
      .setName('List 路径')
      .setDesc('列出资源的 API 路径')
      .addText(text => text
        .setPlaceholder('/v1/resources/list')
        .setValue(this.plugin.settings.listPath || '/v1/resources/list')
        .onChange(async (value) => {
          this.plugin.settings.listPath = value;
          await this.plugin.saveSettings();
          this.plugin.sharedClient = null;
        }));

    containerEl.createEl('h3', { text: '认证设置（用于 PATCH 更新）' });
    new obsidian.Setting(containerEl)
      .setName('使用 Authorization Bearer')
      .setDesc('勾选后使用 Bearer <Token> 进行 PATCH 认证（建议使用用户 JWT）')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useAuthorizationForPatch)
        .onChange(async (value) => {
          this.plugin.settings.useAuthorizationForPatch = value;
          await this.plugin.saveSettings();
          this.plugin.sharedClient = null;
        }));

    new obsidian.Setting(containerEl)
      .setName('PATCH 认证 Token')
      .setDesc('用于 PATCH 的认证令牌（优先于上方 API Key）')
      .addText(text => text
        .setPlaceholder('粘贴用户 JWT 或其他令牌')
        .setValue(this.plugin.settings.authToken || '')
        .onChange(async (value) => {
          this.plugin.settings.authToken = value.trim();
          await this.plugin.saveSettings();
          this.plugin.sharedClient = null;
        }));

    new obsidian.Setting(containerEl)
      .setName('用户名（登录获取 Token）')
      .setDesc('用于获取 PATCH 认证 Token 的用户名')
      .addText(text => text
        .setPlaceholder('输入用户名')
        .setValue(this.plugin.settings.loginUsername || '')
        .onChange(async (value) => {
          this.plugin.settings.loginUsername = value.trim();
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('密码（登录获取 Token）')
      .setDesc('用于获取 PATCH 认证 Token 的密码')
      .addText(text => text
        .setPlaceholder('输入密码')
        .setValue(this.plugin.settings.loginPassword || '')
        .onChange(async (value) => {
          this.plugin.settings.loginPassword = value.trim();
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('登录 URL')
      .setDesc('用于用户名密码登录获取 Token 的接口地址')
      .addText(text => text
        .setPlaceholder('/api/v1/login')
        .setValue(this.plugin.settings.loginUrl || '')
        .onChange(async (value) => {
          this.plugin.settings.loginUrl = value.trim();
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('获取 Token')
      .setDesc('使用用户名密码登录，自动填充 PATCH 认证 Token')
      .addButton(button => button
        .setButtonText('登录并获取')
        .onClick(async () => {
          try {
            const client = this.plugin.getSharedClient();
            client.loginUrl = this.plugin.settings.loginUrl || `${this.plugin.settings.baseUrl}/api/v1/login`;
            const token = await client.loginWithPassword(this.plugin.settings.loginUsername, this.plugin.settings.loginPassword);
            this.plugin.settings.authToken = token;
            await this.plugin.saveSettings();
            new obsidian.Notice('✅ 已获取 Token');
            this.plugin.sharedClient = null;
          } catch (e) {
            console.error('❌ 获取 Token 失败:', e);
            new obsidian.Notice(`❌ 获取 Token 失败: ${e.message}`);
          }
        }));

    new obsidian.Setting(containerEl)
      .setName('从剪贴板填充 Token')
      .setDesc('在浏览器复制 TOKEN 后，点击此按钮快速粘贴到认证 Token')
      .addButton(button => button
        .setButtonText('粘贴 TOKEN')
        .onClick(async () => {
          try {
            const text = await navigator.clipboard.readText();
            const value = String(text || '').trim();
            if (!value) {
              new obsidian.Notice('剪贴板为空');
              return;
            }
            this.settings.authToken = value;
            await this.saveSettings();
            this.sharedClient = null;
            new obsidian.Notice('✅ 已从剪贴板填充 Token');
          } catch (e) {
            new obsidian.Notice(`❌ 读取剪贴板失败: ${e.message}`);
          }
        }));

    new obsidian.Setting(containerEl)
      .setName('自定义认证头名称')
      .setDesc('如果需要额外认证头，如 X-Auth-Token')
      .addText(text => text
        .setPlaceholder('例如：X-Auth-Token')
        .setValue(this.plugin.settings.patchAuthHeaderName || '')
        .onChange(async (value) => {
          this.plugin.settings.patchAuthHeaderName = value.trim();
          await this.plugin.saveSettings();
          this.plugin.sharedClient = null;
        }));

    new obsidian.Setting(containerEl)
      .setName('自定义认证头值')
      .setDesc('与上面的自定义头名称配合使用')
      .addText(text => text
        .setPlaceholder('粘贴对应的令牌值')
        .setValue(this.plugin.settings.patchAuthHeaderValue || '')
        .onChange(async (value) => {
          this.plugin.settings.patchAuthHeaderValue = value.trim();
          await this.plugin.saveSettings();
          this.plugin.sharedClient = null;
        }));

    new obsidian.Setting(containerEl)
      .setName('使用 Cookie token')
      .setDesc('在请求头附加 Cookie: token=<Token>（部分服务需要）')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useCookieTokenForPatch)
        .onChange(async (value) => {
          this.plugin.settings.useCookieTokenForPatch = value;
          await this.plugin.saveSettings();
          this.plugin.sharedClient = null;
        }));

    // 同步目录（仅同步此目录下的 Markdown 文件）
    new obsidian.Setting(containerEl)
      .setName('同步目录')
      .setDesc('仅同步该目录下的 .md 文件（例如：notes 或 docs/knowledge）')
      .addText(text => text
        .setPlaceholder('输入相对路径，如 notes 或 docs/knowledge')
        .setValue(this.plugin.settings.syncFolder || '')
        .onChange(async (value) => {
          this.plugin.settings.syncFolder = value.trim();
          await this.plugin.saveSettings();
        }));

    // 远端目标目录已移除，改为仅依赖远端目标节点

    new obsidian.Setting(containerEl)
      .setName('远端目标节点')
      .setDesc('仅显示根空间下的节点供选择')
      .addDropdown((dropdown) => {
        dropdown.addOption('', '根空间');
        const client = this.plugin.getSharedClient();
        client.getRootChildren()
          .then((rootChildren) => {
            if (Array.isArray(rootChildren)) {
              for (const item of rootChildren) {
                if ((item.resource_type || item.type) !== 'folder') continue;
                const typeLabel = item.resource_type || item.type || 'unknown';
                const nameLabel = (item.name && item.name.trim().length > 0) ? item.name : (item.title || item.id);
                const label = `${nameLabel} (${typeLabel})`;
                dropdown.addOption(String(item.id), label);
              }
            }
            dropdown.setValue(this.plugin.settings.remoteTargetId || '');
          })
          .catch((e) => {
            console.error('加载根节点失败:', e);
            new obsidian.Notice('加载远端根节点失败，请检查认证和接口配置');
          });
        dropdown.onChange(async (value) => {
          this.plugin.settings.remoteTargetId = value;
          await this.plugin.saveSettings();
          console.log('✅ 已选择远端目标节点:', value);
        });
      });

    containerEl.createEl('h3', { text: '同步设置' });

    // 自动同步
    new obsidian.Setting(containerEl)
      .setName('自动同步')
      .setDesc('文件修改后自动同步到 Omnibox')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoSync)
        .onChange(async (value) => {
          this.plugin.settings.autoSync = value;
          await this.plugin.saveSettings();
        }));

    // 启用定时全量同步
    new obsidian.Setting(containerEl)
      .setName('启用定时全量同步')
      .setDesc('按设定的间隔自动执行全量同步')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableFullSync)
        .onChange(async (value) => {
          this.plugin.settings.enableFullSync = value;
          await this.plugin.saveSettings();
        }));

    // 同步间隔
    new obsidian.Setting(containerEl)
      .setName('同步间隔（秒）')
      .setDesc('定时全量同步的间隔时间')
      .addText(text => text
        .setPlaceholder('15')
        .setValue(String(this.plugin.settings.syncInterval))
        .onChange(async (value) => {
          const num = parseInt(value);
          if (!isNaN(num) && num > 0) {
            this.plugin.settings.syncInterval = num;
            await this.plugin.saveSettings();
          }
        }));

    // 保留文件夹层级
    new obsidian.Setting(containerEl)
      .setName('保留文件夹层级')
      .setDesc('同步时保留原有的文件夹结构')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.preserveHierarchy)
        .onChange(async (value) => {
          this.plugin.settings.preserveHierarchy = value;
          await this.plugin.saveSettings();
        }));

    // 测试连接按钮
    new obsidian.Setting(containerEl)
      .setName('测试 API 连接')
      .setDesc('测试 API 配置是否正确')
      .addButton(button => button
        .setButtonText('测试连接')
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await this.plugin.testConnection();
          } finally {
            button.setDisabled(false);
          }
        }));

    // 🔥 新增：测试文件上传
    new obsidian.Setting(containerEl)
      .setName('测试文件上传')
      .setDesc('上传一个测试文件验证 API 端点')
      .addButton(button => button
        .setButtonText('测试上传')
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await this.plugin.testFileUpload();
          } finally {
            button.setDisabled(false);
          }
        }));

    // 手动同步按钮
    new obsidian.Setting(containerEl)
      .setName('手动同步')
      .setDesc('立即同步所有文件到 Omnibox')
      .addButton(button => button
        .setButtonText('立即同步')
        .setCta()
        .onClick(async () => {
          await this.plugin.manualSync();
        }));

    // 清空缓存按钮
    new obsidian.Setting(containerEl)
      .setName('清空缓存')
      .setDesc('清除所有同步缓存记录')
      .addButton(button => button
        .setButtonText('清空缓存')
        .setWarning()
        .onClick(async () => {
          if (confirm('确定要清空所有同步缓存吗？')) {
            this.plugin.sharedCache.clear();
            await this.plugin.saveData({
              ...this.plugin.settings,
              syncCache: []
            });
            new obsidian.Notice('缓存已清空');
          }
        }));

    // 缓存状态
    const cacheSize = this.plugin.sharedCache?.size() || 0;
    containerEl.createEl('p', { 
      text: `当前缓存记录数: ${cacheSize}`,
      cls: 'setting-item-description'
    });
  }
}

// ============================================================
// 主插件类
// ============================================================

class OmniboxSyncPlugin extends obsidian.Plugin {
  
  async onload() {
    console.log("🚀 加载 Omnibox 同步插件");
    
    // 加载设置
    await this.loadSettings();
    
    // 初始化共享实例
    this.sharedClient = null;
    this.sharedCache = null;
    this.modifyTimeouts = new Map();
    this.lastSyncedAtMap = new Map();
    this.inFlightPaths = new Set();
    this.syncActive = false;
    this.syncIntervalId = null;
    this.fullSyncIntervalId = null;
    
    // 加载缓存
    await this.initializeSharedCache();
    await this.autoFetchTokenIfConfigured();
    
    // 添加设置面板
    this.addSettingTab(new OmniboxSettingTab(this.app, this));

    this.addRibbonIcon('refresh-ccw', '全量同步', async () => {
      await this.manualSync();
    });
    
    // 注册命令
    this.addCommand({
      id: 'sync-current-file',
      name: '同步当前文件',
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          await this.syncCurrentFile(file);
        } else {
          new obsidian.Notice('没有打开的文件');
        }
      }
    });

    this.addCommand({
      id: 'sync-all-files',
      name: '同步所有文件',
      callback: async () => {
        await this.manualSync();
      }
    });
    
    // 注册事件监听器
    this.registerEvent(
      this.app.vault.on('modify', (file) => this.onFileModified(file))
    );
    
    this.registerEvent(
      this.app.vault.on('create', (file) => this.onFileCreated(file))
    );
    
    this.registerEvent(
      this.app.vault.on('delete', (file) => this.onFileDeleted(file))
    );
    
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => this.onFileRenamed(file, oldPath))
    );
    
    // 启动自动同步
    if (this.settings.autoSync) {
      this.startAutoSync();
    }
    if (this.settings.enableFullSync) {
      this.startFullSyncScheduler();
    }
    
    console.log("✅ Omnibox 同步插件已加载");
  }
  
  async onunload() {
    console.log("🛑 卸载 Omnibox 插件");
    
    // 停止自动同步
    this.stopAutoSync();
    this.stopFullSyncScheduler();
    
    // 清理所有定时器
    if (this.modifyTimeouts) {
      this.modifyTimeouts.forEach(id => clearTimeout(id));
      this.modifyTimeouts.clear();
    }
    
    // 最后保存一次缓存
    if (this.sharedCache) {
      await this.saveData({
        ...this.settings,
        syncCache: this.sharedCache.save()
      });
    }
    
    // 清理共享实例
    this.sharedClient = null;
    this.sharedCache = null;
    this.lastSyncedAtMap = null;
    this.inFlightPaths = null;
  }
  
  // 🔥 初始化共享缓存
  async initializeSharedCache() {
    this.sharedCache = new SyncCache();
    const cacheData = await this.loadData();
    if (cacheData?.syncCache) {
      this.sharedCache.load(cacheData.syncCache);
      console.log(`📂 缓存加载完成: ${this.sharedCache.size()} 条记录`);
    } else {
      console.log(`📂 初始化空缓存`);
    }
  }
  
  // 🔥 获取共享 Client
  getSharedClient() {
    if (!this.sharedClient) {
      this.sharedClient = new OmniboxClient(
        this.settings.baseUrl,
        this.settings.apiKey,
        this.settings.namespaceId,
        {
          upsertPath: this.settings.upsertPath,
          listPath: this.settings.listPath,
          deletePath: this.settings.deletePath,
          authToken: this.settings.authToken,
          useAuthorizationForPatch: this.settings.useAuthorizationForPatch,
          patchAuthHeaderName: this.settings.patchAuthHeaderName,
          patchAuthHeaderValue: this.settings.patchAuthHeaderValue,
          useCookieTokenForPatch: this.settings.useCookieTokenForPatch
        }
      );
    }
    return this.sharedClient;
  }
  
  normalizePath(path) {
    if (!path) return '';
    return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }
  
  validateSettings() {
    return !!(this.settings?.apiKey && this.settings?.namespaceId && this.settings?.baseUrl);
  }
  
  isIncluded(path) {
    // 排除 .obsidian 文件夹
    if (path.startsWith('.obsidian/')) return false;
    
    // 只包含 markdown 文件
    if (!path.endsWith('.md')) return false;
    
    // 🔥 如果设置了同步文件夹，只同步该文件夹下的文件
    if (this.settings.syncFolder) {
      const syncFolder = this.normalizePath(this.settings.syncFolder);
      const normalizedPath = this.normalizePath(path);
      if (!normalizedPath.startsWith(syncFolder)) {
        return false;
      }
    }
    
    // TODO: 添加更多过滤逻辑
    // if (this.settings.includedFolders.length > 0) {
    //   // 检查是否在包含的文件夹中
    // }
    // if (this.settings.excludedFolders.length > 0) {
    //   // 检查是否在排除的文件夹中
    // }
    
    return true;
  }
  
  // 🔥 修复后的 syncCurrentFile 方法
  async syncCurrentFile(file) {
    // 防止在全量同步期间执行单文件同步
    if (this.syncActive) {
      console.log("⏸️ 全量同步进行中，跳过单文件同步");
      return;
    }
    
    if (!this.validateSettings()) {
      new obsidian.Notice("请先配置 API 设置");
      return;
    }
    
    if (!this.isIncluded(file.path)) {
      return;
    }
    
    const p = this.normalizePath(file.path);
    
    // 检查是否已在同步
    if (this.inFlightPaths.has(p)) {
      console.log(`🔒 文件已在同步: ${p}`);
      return;
    }
    
    try {
      // 🔥 使用共享的 client 和 cache 实例
      const client = this.getSharedClient();
      const cache = this.sharedCache;
      
      const before = cache.getByPath(p);
      
      // 创建 SyncEngine 实例
      const engine = new SyncEngine(client, this.app.vault, cache, this);
      
      // 执行同步
      await engine.syncFile(file);
      
      // syncFile 内部已经持久化了缓存，但为了保险再保存一次
      await this.saveData({
        ...this.settings,
        syncCache: cache.save()
      });
      
      const after = cache.getByPath(p);
      
      // 只在真正同步（不是跳过）时显示通知
      if (after && (!before || (after.lastSyncTime || 0) > (before.lastSyncTime || 0))) {
        new obsidian.Notice(`✅ 已同步: ${file.basename}`);
      }
      
    } catch (error) {
      console.error("❌ 文件同步失败:", error);
      new obsidian.Notice(`❌ 同步失败: ${error.message}`);
    }
  }
  
  // 🔥 改进的文件修改处理器
  onFileModified(file) {
    if (!this.settings.autoSync) return;
    if (!this.isIncluded(file.path)) return;
    
    const p = this.normalizePath(file.path);
    
    // 取消之前的防抖定时器
    const existing = this.modifyTimeouts.get(p);
    if (existing) {
      clearTimeout(existing);
      console.log(`⏱️ 重置防抖定时器: ${p}`);
    }
    
    // 检查节流：距离上次同步是否足够久
    const lastSync = this.lastSyncedAtMap.get(p) || 0;
    const now = Date.now();
    const throttleMs = 10000; // 10秒节流
    
    if (now - lastSync < throttleMs) {
      console.log(`⏸️ 节流中: ${p} (距上次 ${Math.round((now-lastSync)/1000)}s)`);
      return;
    }
    
    // 设置新的防抖定时器
    const timeoutId = setTimeout(() => {
      this.modifyTimeouts.delete(p);
      
      console.log(`🚀 触发同步: ${p}`);
      this.syncCurrentFile(file).finally(() => {
        this.lastSyncedAtMap.set(p, Date.now());
      });
    }, 2000); // 2秒防抖
    
    this.modifyTimeouts.set(p, timeoutId);
  }
  
  onFileCreated(file) {
    if (!this.settings.autoSync) return;
    
    console.log(`📝 文件创建: ${file.path}`);
    if (file instanceof obsidian.TFolder) {
      this.syncFolder(file);
      return;
    }
    if (!this.isIncluded(file.path)) return;
    this.onFileModified(file);
  }
  
  onFileDeleted(file) {
    const p = this.normalizePath(file.path);
    console.log(`🗑️ 文件删除: ${p}`);
    
    // 从缓存中移除
    const cached = this.sharedCache.getByPath(p);
    if (cached) {
      this.sharedCache.delete(cached.id);
      this.saveData({
        ...this.settings,
        syncCache: this.sharedCache.save()
      });
    }
    
    // TODO: 可选择是否同时删除远程资源
  }
  
  onFileRenamed(file, oldPath) {
    const oldP = this.normalizePath(oldPath);
    const newP = this.normalizePath(file.path);
    
    console.log(`✏️ 文件重命名: ${oldP} -> ${newP}`);
    
    // 更新缓存中的路径
    const cached = this.sharedCache.getByPath(oldP);
    if (cached) {
      this.sharedCache.delete(cached.id);
      cached.localPath = newP;
      this.sharedCache.set(cached.id, cached);
      
      this.saveData({
        ...this.settings,
        syncCache: this.sharedCache.save()
      });
    }
    
    // 触发同步更新远程
    if (this.settings.autoSync && this.isIncluded(file.path)) {
      this.syncCurrentFile(file);
    }
  }
  
  // 测试 API 连接
  async testConnection() {
    if (!this.validateSettings()) {
      new obsidian.Notice("请先配置 API 设置");
      return;
    }
    
    try {
      new obsidian.Notice("正在测试连接...");
      
      const client = this.getSharedClient();
      
      console.log('========================================');
      console.log('🔍 开始测试 API 连接');
      console.log('Base URL:', this.settings.baseUrl);
      console.log('Namespace ID:', this.settings.namespaceId);
      console.log('API Key (前10位):', this.settings.apiKey.substring(0, 10));
      console.log('========================================');
      
      // 使用 client 的测试方法
      const result = await client.testConnection();
      
      console.log('✅ 连接测试成功:', result);
      new obsidian.Notice("✅ API 连接成功！");
      
    } catch (error) {
      console.error('========================================');
      console.error('❌ 连接测试失败');
      console.error('错误信息:', error.message);
      console.error('完整错误:', error);
      console.error('========================================');
      
      // 提供更详细的错误提示
      let errorMsg = error.message;
      if (error.message.includes('405')) {
        errorMsg = '405 错误：API 端点或方法不正确\n请检查 API URL 和路径配置';
      } else if (error.message.includes('404')) {
        errorMsg = '404 错误：API 端点不存在\n请确认 API URL 是否正确';
      } else if (error.message.includes('401') || error.message.includes('403')) {
        errorMsg = '认证失败：请检查 API Key 和 Namespace ID';
      }
      
      new obsidian.Notice(`❌ 连接失败:\n${errorMsg}`, 10000);
    }
  }

  // 🔥 新增：测试文件上传
  async testFileUpload() {
    if (!this.validateSettings()) {
      new obsidian.Notice("请先配置 API 设置");
      return;
    }
    
    try {
      new obsidian.Notice("正在测试文件上传...");
      
      const client = this.getSharedClient();
      
      console.log('========================================');
      console.log('🧪 测试文件上传');
      console.log('========================================');
      
      // 创建一个测试文件
      const testPayload = {
        name: 'obsidian-test',
        content: '# 测试文件\n\n这是一个测试文件，用于验证 Obsidian 同步插件的 API 配置。\n\n时间: ' + new Date().toISOString(),
        external_id: 'obsidian-test-' + Date.now(),
        namespaceId: this.settings.namespaceId,
        resource_type: 'file',
        path: 'test/obsidian-test.md',
        parent_id: String((this.settings.remoteTargetId || '').trim() || ''),
        attrs: {
          relative_path: 'test/obsidian-test.md'
        }
      };
      console.log('📤 测试创建请求体:', testPayload);
      
      console.log('📤 发送测试文件...');
      const result = await client.upsertResource(testPayload);
      
      console.log('✅ 上传成功:', result);
      new obsidian.Notice(`✅ 文件上传成功！\nID: ${result.id || 'unknown'}`);
      
    } catch (error) {
      console.error('========================================');
      console.error('❌ 文件上传测试失败');
      console.error('错误信息:', error.message);
      console.error('完整错误:', error);
      console.error('========================================');
      
      let errorMsg = error.message;
      if (error.message.includes('405')) {
        errorMsg = `405 错误：端点 ${this.settings.upsertPath} 不支持 POST 方法\n\n建议检查：\n1. API 路径是否正确\n2. 是否需要使用其他 HTTP 方法\n3. Nginx 配置是否正确`;
      }
      
      new obsidian.Notice(`❌ 上传失败:\n${errorMsg}`, 15000);
    }
  }
  
  // 手动全量同步
  async manualSync() {
    if (this.syncActive) {
      new obsidian.Notice('同步正在进行中...');
      return;
    }
    
    if (!this.validateSettings()) {
      new obsidian.Notice("请先配置 API 设置");
      return;
    }
    
    this.syncActive = true;
    
    try {
      const files = this.app.vault.getMarkdownFiles()
        .filter(f => this.isIncluded(f.path));
      
      if (files.length === 0) {
        new obsidian.Notice('没有需要同步的文件');
        return;
      }
      
      new obsidian.Notice(`开始同步 ${files.length} 个文件...`);
      
      const client = this.getSharedClient();
      const cache = this.sharedCache;
      const engine = new SyncEngine(client, this.app.vault, cache, this);
      const parentId = (this.settings.remoteTargetId || '').trim() || undefined;
      const preserveHierarchy = this.settings.preserveHierarchy !== false;
      const base = engine.normalizePath(this.settings.syncFolder || '');
      if (parentId && preserveHierarchy) {
        const folderSet = new Set();
        for (const f of files) {
          const p = engine.normalizePath(f.path);
          let rel = p;
          if (base) {
            const withSlash = base.endsWith('/') ? base : (base + '/');
            if (rel === base) rel = '';
            else if (rel.startsWith(withSlash)) rel = rel.slice(withSlash.length);
            else if (rel.startsWith(base)) rel = rel.slice(base.length).replace(/^\/+/, '');
          }
          const parts = rel.split('/');
          if (parts.length > 1) {
            const parentPath = parts.slice(0, -1).join('/');
            if (parentPath) folderSet.add(parentPath);
          }
        }
        for (const folderPath of folderSet) {
          await engine.ensureFolder(folderPath, parentId);
        }
      }
      
      const results = await engine.syncAllFiles(files);
      
      // 保存缓存
      await this.saveData({
        ...this.settings,
        syncCache: cache.save()
      });
      
      new obsidian.Notice(
        `同步完成！成功: ${results.success}, 跳过: ${results.skipped}, 失败: ${results.failed}`
      );
      
    } catch (error) {
      console.error('全量同步失败:', error);
      new obsidian.Notice(`同步失败: ${error.message}`);
    } finally {
      this.syncActive = false;
    }
  }
  
  // 启动自动同步
  startAutoSync() {
    console.log('启用自动同步');
  }
  
  // 停止自动同步
  stopAutoSync() {
    console.log('已停止自动同步');
  }

  async autoFetchTokenIfConfigured() {
    const u = String(this.settings.loginUsername || '').trim();
    const p = String(this.settings.loginPassword || '').trim();
    if (!u || !p) return;
    try {
      const client = this.getSharedClient();
      client.loginUrl = this.settings.loginUrl || `${this.settings.baseUrl}/api/v1/login`;
      const token = await client.loginWithPassword(u, p);
      this.settings.authToken = token;
      await this.saveSettings();
      this.sharedClient = null;
      new obsidian.Notice('已自动获取认证 Token');
    } catch (e) {
      console.error('自动获取 Token 失败:', e);
    }
  }

  startFullSyncScheduler() {
    if (this.fullSyncIntervalId) {
      clearInterval(this.fullSyncIntervalId);
    }
    const intervalMs = this.settings.syncInterval * 1000;
    console.log(`启用定时全量同步，间隔 ${this.settings.syncInterval} 秒`);
    this.fullSyncIntervalId = setInterval(() => {
      this.manualSync();
    }, intervalMs);
  }

  stopFullSyncScheduler() {
    if (this.fullSyncIntervalId) {
      clearInterval(this.fullSyncIntervalId);
      this.fullSyncIntervalId = null;
      console.log('已停止定时全量同步');
    }
  }
  
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    const prev = this.settings.upsertPath;
    const bad = ['/open/resources/upload-file', '/v1/resources/upsert', '/open/resources/upsert', '/v1/resources'];
    if (!this.settings.upsertPath || bad.includes(this.settings.upsertPath)) {
      this.settings.upsertPath = '/open/api/v1/resources';
    }
    if (prev !== this.settings.upsertPath) {
      await this.saveSettings();
    }
  }
  
  async saveSettings() {
    await this.saveData(this.settings);
    
    if (this.settings.autoSync) {
      this.startAutoSync();
    } else {
      this.stopAutoSync();
    }
    if (this.settings.enableFullSync) {
      this.startFullSyncScheduler();
    } else {
      this.stopFullSyncScheduler();
    }
  }
}

// ============================================================
// 导出模块
// ============================================================

module.exports = OmniboxSyncPlugin;
