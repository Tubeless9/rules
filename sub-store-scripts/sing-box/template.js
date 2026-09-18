// https://raw.githubusercontent.com/xream/scripts/main/surge/modules/sub-store-scripts/sing-box/template.js
// 修改版：空分组不生成，不使用 COMPATIBLE 占位 outbound
//2026年9月18日 14点23分
// 示例：
// #type=组合订阅&name=机场&outbound=🕳ℹ️all|all-auto🕳ℹ️hk|hk-auto🏷ℹ️港|hk|hongkong|🇭🇰🕳ℹ️tw|tw-auto🏷ℹ️台|tw|taiwan|🇹🇼🕳ℹ️jp|jp-auto🏷ℹ️日本|jp|japan|🇯🇵🕳ℹ️sg|sg-auto🏷ℹ️^(?!.*(?:us)).*(新|sg|singapore|🇸🇬)🕳ℹ️us|us-auto🏷ℹ️美|us|unitedstates|united states|🇺🇸
//
// 🕳 后面是要填充的 outbound 匹配规则
// 🏷 后面是节点 tag 匹配规则
// ℹ️ 表示忽略大小写
//
// 与官方版本相比：
// 1. 不再创建 COMPATIBLE
// 2. 没有匹配节点的 selector 直接删除
// 3. 自动清理 selector 中已经不存在的 tag
// 4. 自动清理 route.rules 中已经不存在的 outbound
// 5. 自动删除重复 outbound tag

log(`🚀 开始`)

let {
  type,
  name,
  outbound,
  includeUnsupportedProxy,
  url,
} = $arguments

log(`传入参数 type: ${type}, name: ${name}, outbound: ${outbound}`)

type = /^1$|col|组合/i.test(type)
  ? 'collection'
  : 'subscription'

const parser = ProxyUtils.JSON5 || JSON

log(`① 使用 ${ProxyUtils.JSON5 ? 'JSON5' : 'JSON'} 解析配置文件`)

let config

try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  log(`${e.message ?? e}`)
  throw new Error(
    `配置文件不是合法的 ${ProxyUtils.JSON5 ? 'JSON5' : 'JSON'} 格式`
  )
}

log(`② 获取订阅`)

let proxies = []
let outbounds = []
let endpoints = []
let data = {}

if (url) {
  log(`直接从 URL ${url} 读取订阅`)

  data = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy,
    },
    subscription: {
      name,
      url,
      source: 'remote',
    },
  })
} else {
  log(
    `将读取名称为 ${name} 的 ${
      type === 'collection' ? '组合' : ''
    }订阅`
  )

  data = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy,
    },
  })

  console.log(data)
}

data = JSON.parse(data)

/*
 * 关键修复：
 *
 * produceArtifact() 返回的 data.outbounds
 * 本身可能已经包含 COMPATIBLE。
 *
 * 如果这里不删除：
 *
 * data.outbounds
 *     ↓
 * outbounds
 *     ↓
 * 后面的 config.outbounds.push(...outbounds)
 *     ↓
 * COMPATIBLE 又重新进入最终配置
 *
 * 所以必须在这里直接过滤。
 */

outbounds = (data.outbounds ?? []).filter(
  outbound => outbound?.tag !== 'COMPATIBLE'
)

endpoints = data.endpoints ?? []

proxies = [...outbounds, ...endpoints]

log(
  `获取到 ${outbounds.length} 个节点, ${endpoints.length} 个端点`
)

/*
 * ③ outbound 规则解析
 */

log(`③ outbound 规则解析`)

const outboundRules = (outbound || '')
  .split('🕳')
  .map(i => i.trim())
  .filter(i => i)
  .map(i => {
    let [outboundPattern, tagPattern = '.*'] =
      i.split('🏷')

    const tagRegex = createTagRegExp(tagPattern)

    log(
      `匹配 🏷 ${tagRegex} 的节点将插入匹配 🕳 ${createOutboundRegExp(
        outboundPattern
      )} 的 outbound 中`
    )

    return [
      outboundPattern,
      tagRegex,
    ]
  })

/*
 * ④ 确保 config.outbounds 存在
 */

log(`④ outbound 插入节点`)

if (!Array.isArray(config.outbounds)) {
  config.outbounds = []
}

/*
 * 先删除旧的 COMPATIBLE。
 *
 * 这样即使基础模板本身已经存在 COMPATIBLE，
 * 也不会继续保留这个占位 outbound。
 */

const compatibleCount = config.outbounds.filter(
  outbound => outbound?.tag === 'COMPATIBLE'
).length

if (compatibleCount > 0) {
  log(
    `🗑 删除 ${compatibleCount} 个旧 COMPATIBLE outbound`
  )

  config.outbounds = config.outbounds.filter(
    outbound => outbound?.tag !== 'COMPATIBLE'
  )
}

/*
 * 将订阅节点插入对应 selector。
 */

config.outbounds.forEach(outboundItem => {
  outboundRules.forEach(
    ([outboundPattern, tagRegex]) => {
      const outboundRegex =
        createOutboundRegExp(outboundPattern)

      if (!outboundRegex.test(outboundItem.tag)) {
        return
      }

      if (!Array.isArray(outboundItem.outbounds)) {
        outboundItem.outbounds = []
      }

      const tags = getTags(proxies, tagRegex)

      log(
        `🕳 ${outboundItem.tag} 匹配 ${outboundRegex}, 插入 ${tags.length} 个 🏷 匹配 ${tagRegex} 的节点`
      )

      outboundItem.outbounds.push(...tags)
    }
  )
})

/*
 * ⑤ 删除重复节点 tag
 *
 * 同一个 tag 只保留第一次出现。
 */

log(`⑤ 清理重复 outbound tag`)

const seenTags = new Set()
const duplicateTags = new Set()

config.outbounds = config.outbounds.filter(
  outboundItem => {
    if (!outboundItem?.tag) {
      return true
    }

    if (seenTags.has(outboundItem.tag)) {
      duplicateTags.add(outboundItem.tag)
      return false
    }

    seenTags.add(outboundItem.tag)

    return true
  }
)

if (duplicateTags.size > 0) {
  log(
    `🗑 删除重复 tag: ${[
      ...duplicateTags,
    ].join(', ')}`
  )
}

/*
 * ⑥ 判断哪些 outbound 是由本脚本规则管理的。
 *
 * 例如：
 *
 * 🕳ℹ️🇭🇰 香港手动🏷ℹ️...
 *
 * 那么「香港手动」就是一个 managed outbound。
 */

const managedOutboundTags = new Set()

config.outbounds.forEach(outboundItem => {
  if (!outboundItem?.tag) {
    return
  }

  const matched = outboundRules.some(
    ([outboundPattern]) => {
      const outboundRegex =
        createOutboundRegExp(outboundPattern)

      return outboundRegex.test(outboundItem.tag)
    }
  )

  if (matched) {
    managedOutboundTags.add(outboundItem.tag)
  }
})

/*
 * ⑦ 删除没有节点的动态分组
 *
 * 官方版本：
 *
 * 空分组
 *    ↓
 * 自动创建 COMPATIBLE
 *
 * 本版本：
 *
 * 空分组
 *    ↓
 * 直接删除
 */

log(`⑥ 删除没有匹配节点的空分组`)

const removedEmptyGroups = []

config.outbounds = config.outbounds.filter(
  outboundItem => {
    if (
      !managedOutboundTags.has(
        outboundItem?.tag
      )
    ) {
      return true
    }

    if (
      !Array.isArray(
        outboundItem.outbounds
      )
    ) {
      outboundItem.outbounds = []
    }

    /*
     * 去重
     */

    outboundItem.outbounds = [
      ...new Set(
        outboundItem.outbounds.filter(Boolean)
      ),
    ]

    /*
     * 没有任何节点：
     * 删除整个分组
     */

    if (
      outboundItem.outbounds.length === 0
    ) {
      removedEmptyGroups.push(
        outboundItem.tag
      )

      log(
        `🗑 删除空分组: ${outboundItem.tag}`
      )

      return false
    }

    return true
  }
)

if (removedEmptyGroups.length > 0) {
  log(
    `共删除 ${removedEmptyGroups.length} 个空分组: ${removedEmptyGroups.join(
      ', '
    )}`
  )
} else {
  log(`没有需要删除的空分组`)
}

/*
 * ⑧ 插入真实节点
 */

log(`⑦ 插入真实节点`)

config.outbounds.push(...outbounds)

/*
 * ⑨ endpoints
 */

if (!Array.isArray(config.endpoints)) {
  config.endpoints = []
}

config.endpoints.push(...endpoints)

/*
 * ⑩ 重新建立有效 tag 集合
 */

const validOutboundTags = new Set(
  config.outbounds
    .map(outboundItem => outboundItem?.tag)
    .filter(Boolean)
)

const validEndpointTags = new Set(
  config.endpoints
    .map(endpoint => endpoint?.tag)
    .filter(Boolean)
)

const validTags = new Set([
  ...validOutboundTags,
  ...validEndpointTags,
])

/*
 * ⑪ 清理所有 selector/urltest 等 outbound 引用
 *
 * 例如：
 *
 * "默认代理": [
 *   "日本手动",
 *   "狮城手动",
 *   "香港手动",
 *   "美国手动"
 * ]
 *
 * 如果香港手动因为没有节点被删除：
 *
 * "默认代理": [
 *   "日本手动",
 *   "狮城手动",
 *   "美国手动"
 * ]
 */

log(`⑧ 清理不存在的 outbound 引用`)

config.outbounds.forEach(outboundItem => {
  if (
    !Array.isArray(
      outboundItem.outbounds
    )
  ) {
    return
  }

  const oldLength =
    outboundItem.outbounds.length

  outboundItem.outbounds = [
    ...new Set(
      outboundItem.outbounds.filter(
        tag => validTags.has(tag)
      )
    ),
  ]

  const removed =
    oldLength -
    outboundItem.outbounds.length

  if (removed > 0) {
    log(
      `🧹 ${outboundItem.tag} 删除 ${removed} 个不存在的 outbound 引用`
    )
  }
})

/*
 * ⑫ 删除清理后再次变成空的动态分组
 *
 * 比如：
 *
 * 香港手动
 *   ↓
 * 原本引用 COMPATIBLE
 *   ↓
 * COMPATIBLE 已删除
 *   ↓
 * 香港手动再次为空
 *   ↓
 * 删除香港手动
 */

const secondRemovedGroups = []

config.outbounds = config.outbounds.filter(
  outboundItem => {
    if (
      !managedOutboundTags.has(
        outboundItem?.tag
      )
    ) {
      return true
    }

    if (
      !Array.isArray(
        outboundItem.outbounds
      ) ||
      outboundItem.outbounds.length === 0
    ) {
      secondRemovedGroups.push(
        outboundItem.tag
      )

      log(
        `🗑 二次清理空分组: ${outboundItem.tag}`
      )

      return false
    }

    return true
  }
)

if (secondRemovedGroups.length > 0) {
  log(
    `二次删除 ${secondRemovedGroups.length} 个空分组`
  )
}

/*
 * ⑬ 重新建立最终有效 tag
 */

const finalValidTags = new Set(
  config.outbounds
    .map(outboundItem => outboundItem?.tag)
    .filter(Boolean)
)

const finalEndpointTags = new Set(
  config.endpoints
    .map(endpoint => endpoint?.tag)
    .filter(Boolean)
)

const allValidTags = new Set([
  ...finalValidTags,
  ...finalEndpointTags,
])

/*
 * ⑭ 再次清理 selector 引用
 */

config.outbounds.forEach(outboundItem => {
  if (
    !Array.isArray(
      outboundItem.outbounds
    )
  ) {
    return
  }

  outboundItem.outbounds = [
    ...new Set(
      outboundItem.outbounds.filter(
        tag => allValidTags.has(tag)
      )
    ),
  ]
})

/*
 * ⑮ 清理 route.rules 中已经不存在的 outbound
 *
 * sing-box 的 route rule 可能直接引用：
 *
 * "outbound": "香港手动"
 *
 * 如果香港手动被删除，
 * 这个 route rule 也必须清理。
 */

log(`⑨ 检查 route.rules outbound 引用`)

if (
  config.route &&
  Array.isArray(config.route.rules)
) {
  config.route.rules =
    config.route.rules.filter(rule => {
      if (
        typeof rule?.outbound ===
        'string'
      ) {
        if (
          !allValidTags.has(
            rule.outbound
          )
        ) {
          log(
            `🧹 删除无效 route outbound: ${rule.outbound}`
          )

          return false
        }
      }

      return true
    })
}

/*
 * ⑯ 清理 route.rules 中的 outbounds 数组
 *
 * 某些配置可能使用：
 *
 * "outbounds": [
 *   "香港手动",
 *   "美国手动"
 * ]
 */

if (
  config.route &&
  Array.isArray(config.route.rules)
) {
  config.route.rules =
    config.route.rules
      .map(rule => {
        if (
          Array.isArray(
            rule?.outbounds
          )
        ) {
          rule.outbounds = [
            ...new Set(
              rule.outbounds.filter(
                tag =>
                  allValidTags.has(tag)
              )
            ),
          ]

          /*
           * 如果 outbounds 数组已经空了，
           * 删除这条 rule，避免生成无效配置。
           */

          if (
            rule.outbounds.length === 0
          ) {
            return null
          }
        }

        return rule
      })
      .filter(Boolean)
}

/*
 * ⑰ 最终统计
 */

const finalProxyCount =
  outbounds.length + endpoints.length

const finalOutboundCount =
  config.outbounds.length

const finalEmptyGroups =
  config.outbounds.filter(
    outboundItem =>
      Array.isArray(
        outboundItem.outbounds
      ) &&
      outboundItem.outbounds.length === 0
  )

log(`⑩ 最终配置统计`)
log(`真实节点/端点: ${finalProxyCount}`)
log(`最终 outbound: ${finalOutboundCount}`)
log(
  `最终空分组: ${finalEmptyGroups.length}`
)

if (finalEmptyGroups.length > 0) {
  log(
    `⚠️ 仍存在空 outbound: ${finalEmptyGroups
      .map(i => i.tag)
      .join(', ')}`
  )
}

/*
 * ⑱ 输出配置
 */

$content = JSON.stringify(
  config,
  null,
  2
)

log(`🔚 结束`)

/*
 * ============================
 * 工具函数
 * ============================
 */

function getTags(
  proxies,
  regex
) {
  return (
    regex
      ? proxies.filter(
          proxy =>
            proxy?.tag &&
            regex.test(proxy.tag)
        )
      : proxies
  )
    .map(proxy => proxy.tag)
    .filter(Boolean)
}

function log(v) {
  console.log(
    `[📦 sing-box 模板脚本] ${v}`
  )
}

function createTagRegExp(
  tagPattern
) {
  if (!tagPattern) {
    return /.*/
  }

  const ignoreCase =
    tagPattern.includes('ℹ️')

  const pattern =
    tagPattern.replace(
      'ℹ️',
      ''
    )

  return new RegExp(
    pattern,
    ignoreCase ? 'i' : undefined
  )
}

function createOutboundRegExp(
  outboundPattern
) {
  if (!outboundPattern) {
    return /.*/
  }

  const ignoreCase =
    outboundPattern.includes('ℹ️')

  const pattern =
    outboundPattern.replace(
      'ℹ️',
      ''
    )

  return new RegExp(
    pattern,
    ignoreCase ? 'i' : undefined
  )
}
