# Doom Parser

Parses DooM WAD files in Javascript.

Lump types supported:

* TEXTURE
* PATCH
* FLAT
* THING
* LINEDEF
* SIDEDEF
* VERTEX
* SEG
* SSECT
* NODE
* SECTOR
* BLOCKMAP
* GL_VERT
* GL_SEGS
* GL_SSECT
* GL_NODES

## Example usage

```Javascript
import { WadLoader } from 'doom-parser';

// Load your WAD files (for example from a file input or fetch).
const iwadData = await fetch('DOOM.WAD').then(res => res.arrayBuffer());
const pwadData = await fetch('CUSTOM.WAD').then(res => res.arrayBuffer());

// Initialize the WadLoader with IWAD first, then PWADs.
const wadLoader = new WadLoader([iwadData, pwadData]);

// Find available maps.
const maps = wadLoader.findMaps();
console.log('Maps:', maps);

// Load a map and list all its things.
const map = wadLoader.loadMap(maps[0]);

for (let i = 0; i < map.thingCount; i++) {
  const thing = map.thing(i);
  console.log(`Thing ${i}:`, thing);
}
```

## Wads Files:

The shareware `DOOM1.WAD` can be downloaded [here](https://ia801909.us.archive.org/view_archive.php?archive=/2/items/doom_20230531/doom_dos.ZIP).

`Freedoom 1 & 2` (open source replacement PWADs for non-shareware episodes) are available [here](https://archive.org/download/freedoom-0.13.0/freedoom-0.13.0.zip/freedoom-0.13.0%2Ffreedoom1.wad) and [here](https://archive.org/download/freedoom-0.13.0/freedoom-0.13.0.zip/freedoom-0.13.0%2Ffreedoom2.wad)

`Skulltag-v097d5.wad` is available [here]().

## API

The system uses the following classes. Classes marked with a `*` are not directly exported by the module, but are returned by methods.

### WadLoader

WadLoader exposes the same methods as Wad, but the constructor takes multiple byte arrays, allowing overrides for mods.

The first file supplied should be an IWAD ([doom wiki](https://doomwiki.org/wiki/IWAD)). This is not *required* but is **strongly** suggested. The following files,may be a mix of IWADS and [PWADS](https://doomwiki.org/wiki/PWAD).

The LAST file in the list will be checked FIRST, proceeding backward through the list.

### Wad

Represents all levels, images, sounds, animations and other resources in the game. Secondary WAD files (PWADS) (see above) can contain additional resources or override original resources in IWADS.

#### constructor(byteArray)

Initialize an instance from an ArrayBuffer or Uint8Array.

#### type

String property. Should be `IWAD` or `PWAD` in an uncorrupted WAD file.

#### format

String property. Should be `DOOM`, `HEXEN` or `SRB2` in an uncorrupted WAD file.

#### lumpCount

Integer property. The number of lumps in the wad.

#### findMaps()

Returns an array of the names of all the maps in the WAD.

#### loadMap(mapName)

Returns a WadMap object or undefined.

#### getDirEntry(name)

Returns a directory entry object with the following properties:

* `index` The index of the lump referred to by the directory entry.
- `pos` The offset in the WAD data where the lump starts.
- `size` The number of bytes in the lump.
- `name` The name of the lump.
* `wad` A reference back to the Wad object that generated the lump.

#### getEntryByName(name)

Returns a directory entry object (see above) by name.

#### lump(index)

Return a Uint8Array slice of the WAD containing the data from the lump at the numeric index.

#### getLumpByName(name)

Returns a lump (Uint8Array) by name.


#### flat(name)

Returns a Flat object by name. These are used for floors or ceilings.

#### flatAnimation(prefix)

Returns an array of Textures representing an animation. The animation is named by its prefix. For example, the quintessential `NUKAGE` animation is named as such because the textures that comprise it are named `NUKAGE1`, `NUKAGE2`, and `NUKAGE3`.

#### texture(name)

Returns a Texture object by name. These are used for walls.

#### textureAnimation(prefix)

Similar to flatAnimation, but for walls instead of floors and ceilings.

### WadMap*

#### format

String property. Should be `DOOM`, `HEXEN` or `SRB2` in an uncorrupted WAD file.

#### bounds

Returns a [Bounds](#Bounds) object containing the maximum and minimum boundaries of the map.

#### dump()

Dumps the map data to a JSON stringify-able object.

#### bspPoint(x, y)

Returns a sector given a point at (x, y) using the bsp tree in the GL_NODES lump. This can be generated with [zdbsp-wasm](https://github.com/seanmorris/zdbsp-wasm)

#### thingCount

Number property. The amount of things in the map.

#### thing(index)

Returns a Thing object by index. THINGS are formatted differently in DOOM and HEXEN maps.

DOOM format maps have THINGS with the following properties:

* `x`
* `y`
* `angle`
* `type`
* `flags`

 HEXEN format maps have THINGS with the following properties:

* `id`
* `x`
* `y`
* `z`
* `angle`
* `type`
* `flags`
* `special`
* `arg1`
* `arg2`
* `arg3`
* `arg4`
* `arg5`
* `index`

#### linedefCount

Number property. The amount of linedefs in the map.

#### linedef(index)

Returns a Linedef object by index. LINEDEFs are formatted differently in DOOM and HEXEN maps.

DOOM format maps have LINEDEFs with the following properties:

* `from`
* `to`
* `flags`
* `types`
* `tag`
* `right`
* `left`
* `index`

HEXEN format maps have LINEDEFs with the following properties:

* `from`
* `to`
* `flags`
* `right`
* `left`
* `special`
* `arg1`
* `arg2`
* `arg3`
* `arg4`
* `arg5`
* `index`

#### sidedefCount

Number property. The amount of sidedefs in the map.
* `index`

#### sidedef(index)

Returns a Sidedef object by index. SIDEDEFS have the following properties:

* `xOffset`
* `yOffset`
* `upper`
* `lower`
* `middle`
* `sector`

#### vertexCount

Number property. The amount of vertices in the map.

#### vertex(index)

Returns a Vertex object by index with the following properties:

* `x`
* `y`
* `index`
* `gl`
* `virtual`

#### segCount

Number property. The amount of segs in the map.

#### seg(index)

Returns a Seg object by index with the following properties:

* `start`
* `end`
* `angle`
* `linedef`
* `dir`
* `offset`
* `index`

#### subsectorCount

Number property. The amount of subsectors in the map.

#### subsector(index)

Returns a subsector object by index with the following properties:

* `count`
* `start`

#### nodeCount

Number property. The amount of nodes in the map.

#### node(index)

Returns a node object by index with the following properties:

* `x`
* `y`
* `dx`
* `dy`
* `right`
* `left`
* `index`

#### sectorCount

Number property. The amount of sectors in the map.

#### sector(index)

Returns a [sector](#sector) object by index.

#### blockmapOrigin

Returns the origin point of the BLOCKMAP ([doom wiki](https://doomwiki.org/wiki/Blockmap))

#### blockCount

Number property. The amount of blocks in the map's blockmap.

#### block(index)

Returns a Block object by index.

#### blockForPoint(x, y)

Returns the block that contains the point at (x, y).

#### glVertVersion

Returns the encoding version used for the GL_VERT lump.

#### glVertCount

Number property. The amount of glVerts in the map.

#### glVert(index)

Returns a glVert object by index.

#### glSegVersion

Returns the encoding version used for the GL_SEGS lump.

#### glSegCount

Number property. The amount of glSegs in the map.

#### glSeg(index)

Returns a glSeg object by index.

#### glSubsectVersion

Returns the encoding version used for the GL_SSECT lump.

#### glSubsectorCount

Number property. The amount of glSubsectors in the map.

#### glSubsector(index)

Returns a glSubsector object by index.

#### glNodeVersion

Returns the encoding version used for the GL_NODES lump.

#### glNodeCount()

Number property. The amount of glNodes in the map.

#### glNode(index)

Returns a glNode object by index.

### Flat*

Represents a "texture" used for floors and ceilings.

#### decode(lightLevel) *async*

Decodes the image data to png with the COLORMAP pallet of the given lightLevel. Returns a [ResourceUrl](#ResourceUrl) object.

lightLevel should be a number from 0 to 33.

Read more about the [COLORMAP](https://doomwiki.org/wiki/COLORMAP) on the Doom wiki.

### Texture*

Represents a texture used for walls.

#### decode(lightLevel) *async*

Decodes the image data to png with the COLORMAP pallet of the given lightLevel. Returns a [ResourceUrl](#ResourceUrl) object.

lightLevel should be a number from 0 to 33.

### Sector*

Represents a single "room" or a part of one with uniform floor and ceiling height throughout. Sectors can be contained completely within other sectors.

#### bounds

Returns a [Bounds](#Bounds) object containing the maximum and minimum boundaries of the sector.

### GlSubsector*

Represents a single convex polygon "chunk" of a sector. Can be generated with [zdbsp-wasm](https://github.com/seanmorris/zdbsp-wasm)

#### bounds

Returns a [Bounds](#Bounds) object containing the maximum and minimum boundaries of the GlSubsector.

### Bounds*

Represents a bounding box in world-space.

* `xCenter` the x center of the boundary
* `yCenter` the y center of the boundary
* `xPosition` the x position of the boundary (xMin + xCenter)
* `yPosition` the x position of the boundary (yMin + yCenter)
* `width` the width of the boundary
* `height` the height of the boundary
* `xMin` the min x boundary
* `xMax` the max x boundary
* `yMin` the min y boundary
* `yMax` the max y boundary

### ResourceUrl*

An object wrapping an ObjectURL. Stringifies to the URL itself. The object is registered to a FinalizationRegistry, and the URL will automatically [revoked](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static) when this object is garbage collected.

#### constructor(blob)

Creates a ResourceUrl object for a given blob.

#### revoke()

Revoke the URL ahead of time.
