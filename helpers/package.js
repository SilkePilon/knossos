import JSZip from 'jszip'
import TOML from '@ltd/j-toml'

export const createDataPackVersion = async function (
  project,
  version,
  primaryFile,
  members,
  allGameVersions,
  loaders
) {
  // force version to start with number, as required by FML
  const newVersionNumber = version.version_number.match(/^\d/)
    ? version.version_number
    : `1-${version.version_number}`

  const newSlug = `mr_${project.slug.replace('-', '_').replace(/\W/g, '')}`.substring(0, 63)

  const iconPath = `${project.slug}_pack.png`

  const config = useRuntimeConfig()

  const fabricModJson = {
    schemaVersion: 1,
    id: newSlug,
    version: newVersionNumber,
    name: project.title,
    description: project.description,
    authors: members.map((x) => x.name),
    contact: {
      homepage: `${config.public.siteUrl}/${project.project_type}/${project.slug ?? project.id}`,
    },
    license: project.license.id,
    icon: iconPath,
    environment: '*',
    depends: {
      'fabric-resource-loader-v0': '*',
    },
  }

  const quiltModJson = {
    schema_version: 1,
    quilt_loader: {
      group: 'com.modrinth',
      id: newSlug,
      version: newVersionNumber,
      metadata: {
        name: project.title,
        description: project.description,
        contributors: members.reduce(
          (acc, x) => ({
            ...acc,
            [x.name]: x.role,
          }),
          {}
        ),
        contact: {
          homepage: `${config.public.siteUrl}/${project.project_type}/${
            project.slug ?? project.id
          }`,
        },
        icon: iconPath,
      },
      intermediate_mappings: 'net.fabricmc:intermediary',
      depends: [
        {
          id: 'quilt_resource_loader',
          versions: '*',
          unless: 'fabric-resource-loader-v0',
        },
      ],
    },
  }

  const cutoffIndex = allGameVersions.findIndex((x) => x.version === '1.18.2')

  let maximumIndex = Number.MIN_VALUE
  for (const val of version.game_versions) {
    const index = allGameVersions.findIndex((x) => x.version === val)
    if (index > maximumIndex) {
      maximumIndex = index
    }
  }

  const newForge = maximumIndex < cutoffIndex

  const forgeModsToml = {
    modLoader: newForge ? 'lowcodefml' : 'javafml',
    loaderVersion: newForge ? '[40,)' : '[25,)',
    license: project.license.id,
    showAsResourcePack: false,
    mods: [
      {
        modId: newSlug,
        version: newVersionNumber,
        displayName: project.title,
        description: project.description,
        logoFile: iconPath,
        updateJSONURL: `${config.public.apiBaseUrl.replace('/v2/', '')}/updates/${
          project.id
        }/forge_updates.json`,
        credits: 'Generated by Beehive',
        authors: members.map((x) => x.name).join(', '),
        displayURL: `${config.public.siteUrl}/${project.project_type}/${
          project.slug ?? project.id
        }`,
      },
    ],
  }

  if (project.source_url) {
    quiltModJson.quilt_loader.metadata.contact.sources = project.source_url
    fabricModJson.contact.sources = project.source_url
  }

  if (project.issues_url) {
    quiltModJson.quilt_loader.metadata.contact.issues = project.issues_url
    fabricModJson.contact.issues = project.issues_url
    forgeModsToml.issueTrackerURL = project.issues_url
  }

  const primaryFileData = await (await fetch(primaryFile.url)).blob()

  const primaryZipReader = new JSZip()
  await primaryZipReader.loadAsync(primaryFileData)

  if (loaders.includes('fabric')) {
    primaryZipReader.file('fabric.mod.json', JSON.stringify(fabricModJson))
  }
  if (loaders.includes('quilt')) {
    primaryZipReader.file('quilt.mod.json', JSON.stringify(quiltModJson))
  }
  if (loaders.includes('forge')) {
    primaryZipReader.file('META-INF/mods.toml', TOML.stringify(forgeModsToml, { newline: '\n' }))
  }

  if (!newForge && loaders.includes('forge')) {
    const classFile = new Uint8Array(
      await (
        await fetch('https://cdn.modrinth.com/wrapper/ModrinthWrapperRestiched.class')
      ).arrayBuffer()
    )

    let binary = ''
    for (let i = 0; i < classFile.byteLength; i++) {
      binary += String.fromCharCode(classFile[i])
    }

    let sanitizedId = project.id

    if (project.id.match(/^(\d+)/g)) {
      sanitizedId = '_' + sanitizedId
    }

    sanitizedId = sanitizedId.substring(0, 8)

    binary = binary
      .replace(
        String.fromCharCode(32) + 'needs1to1be1changed1modrinth1mod',
        String.fromCharCode(newSlug.length) + newSlug
      )
      .replace('/wrappera/', `/${sanitizedId}/`)

    const newArr = []
    for (let i = 0; i < binary.length; i++) {
      newArr.push(binary.charCodeAt(i))
    }

    primaryZipReader.file(
      `com/modrinth/${sanitizedId}/ModrinthWrapper.class`,
      new Uint8Array(newArr)
    )
  }

  const resourcePack = version.files.find((x) => x.file_type === 'required-resource-pack')

  const resourcePackData = resourcePack ? await (await fetch(resourcePack.url)).blob() : null

  if (resourcePackData) {
    const resourcePackReader = new JSZip()
    await resourcePackReader.loadAsync(resourcePackData)

    for (const [path, file] of Object.entries(resourcePackReader.files)) {
      if (!primaryZipReader.file(path) && !path.includes('.mcassetsroot')) {
        primaryZipReader.file(path, await file.async('uint8array'))
      }
    }
  }

  if (primaryZipReader.file('pack.png')) {
    primaryZipReader.file(iconPath, await primaryZipReader.file('pack.png').async('uint8array'))
  }

  return await primaryZipReader.generateAsync({
    type: 'blob',
    mimeType: 'application/java-archive',
  })
}
