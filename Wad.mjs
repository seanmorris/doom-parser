import { WeakerMap } from 'weakermap/WeakerMap.mjs';

const dec = new TextDecoder;

const SHORT = 2;
const INT   = 4;
const CHAR  = 1;
const BYTE  = 1;

const DIR_ENTRY_LEN = 2*INT + 8*CHAR;

const MAP_LUMPS = Object.freeze([
	'THINGS'
	, 'LINEDEFS'
	, 'SIDEDEFS'
	, 'VERTEXES'
	, 'SEGS'     //*
	, 'SSECTORS' //*
	, 'NODES'    //*
	, 'SECTORS'
	, 'REJECT'   //*
	, 'BLOCKMAP' //*
	, 'BEHAVIOR' //*
	, 'SCRIPTS'  //*
	// , 'GL_[MAP]'
	, 'GL_VERT'
	, 'GL_SEGS'
	, 'GL_SSECT'
	, 'GL_NODES'
	, 'GL_PVS'
	, 'WADCSRC'
]);

const SIDEDEF_LEN =  2*SHORT + 3*8*CHAR + 1*SHORT;
const VERTEX_LEN  =  2*SHORT;
const SEG_LEN     =  2*SHORT;
const SSECTOR_LEN =  2*SHORT;
const NODE_LEN    = 14*SHORT;
const SECTOR_LEN  =  2*SHORT + 2*8*CHAR + 3*SHORT;

function decodeText(bytes)
{
	return dec.decode(bytes).replace(/\0*$/, '')
}

const nearestPointOnLine = (px, py, x1, y1, x2, y2) => {
	const dx = x2 - x1;
	const dy = y2 - y1;

	if(!dx && !dy)
	{
		return {x: 0, y: 0};
	}

	const t = (((px - x1) * dx + (py - y1) * dy) / (dx**2 + dy**2));
	const c = Math.max(0, Math.min(1, t));

	const x = x1 + c *dx;
	const y = y1 + c *dy;

	return {x, y};
};

const UrlRegistry = new FinalizationRegistry(url => URL.revokeObjectURL(url));

class ResourceUrl
{
	constructor(blob)
	{
		this.url = URL.createObjectURL(blob);
		UrlRegistry.register(this, this.url, this);
	}

	revoke()
	{
		URL.revokeObjectURL(this.url);
		UrlRegistry.unregister(this);
	}

	[Symbol.toPrimitive](hint)
	{
		return this.url;
	}
}

class Bounds
{
	constructor({xMin, yMin, xMax, yMax})
	{
		this.xMin = xMin;
		this.xMax = xMax;
		this.yMin = yMin;
		this.yMax = yMax;

		this.width  = xMax - xMin
		this.height = yMax - yMin;

		this.xCenter = this.width / 2;
		this.yCenter = this.height / 2;

		this.xPosition = this.xMin + this.xCenter;
		this.yPosition = this.yMin + this.yCenter;

		Object.freeze(this);
	}
}

const stitched = new WeakMap;

class GlSubsector
{
	constructor({map, count, first, index})
	{
		this.map   = map;
		this.count = count;
		this.first = first;
		this.index = index;

		Object.defineProperties(this, {
			cache: {value: {}},
		});

		Object.freeze(this);
	}

	vertexes()
	{
		const vertexes = [];

		for(let i = 0; i < this.count; i++)
		{
			const seg  = this.map.glSeg(this.first + i);
			const from = seg.startIsGlVert ? this.map.glVert(seg.start) : this.map.vertex(seg.start);
			const to   = seg.endIsGlVert   ? this.map.glVert(seg.end)   : this.map.vertex(seg.end);

			const v = [];

			if(i === 0)
			{
				v.push(from, to);
			}
			else
			{
				v.push(to);
			}

			for(const w of v)
			{
				if(this.map.stitched.has(w))
				{
					vertexes.push( this.map.stitched.get(w) );
					continue;
				}

				vertexes.push(w);
			}
		}

		return vertexes;
	}

	get bounds()
	{
		if('bounds' in this.cache)
		{
			return this.cache.bounds;
		}

		let xMin =  Infinity, yMin =  Infinity;
		let xMax = -Infinity, yMax = -Infinity;

		for(const vertex of this.vertexes())
		{
			xMin = Math.min(vertex.x, xMin);
			yMin = Math.min(vertex.y, yMin);

			xMax = Math.max(vertex.x, xMax);
			yMax = Math.max(vertex.y, yMax);
		}

		return this.cache.bounds = new Bounds({xMin, yMin, xMax, yMax});
	}

	get sector()
	{
		for(let i = 0; i < this.count; i++)
		{
			const seg = this.map.glSeg(this.first + i);

			if(seg.linedef > 0)
			{
				const linedef = this.map.linedef(seg.linedef);
				const sidedef = this.map.sidedef(seg.side ? linedef.left : linedef.right);

				return sidedef.sector;
			}
		}

		return null;
	}
}

class GlNode
{
	constructor({map, x, y, dx, dy, right, left, index})
	{
		this.map   = map;
		this.x     = x;
		this.y     = y;
		this.dx    = dx;
		this.dy    = dy;
		this.right = right;
		this.left  = left;
		this.index = index;
	}
}

class Sector
{
	constructor({
		floorHeight,
		ceilingHeight,
		floorFlat,
		ceilingFlat,
		lightLevel,
		special,
		tag,
		index,
		map,
	}){
		this.floorHeight   = floorHeight;
		this.ceilingHeight = ceilingHeight;
		this.floorFlat     = floorFlat;
		this.ceilingFlat   = ceilingFlat;
		this.lightLevel    = lightLevel;
		this.special       = special;
		this.tag           = tag;
		this.index         = index;
		this.map           = map;

		Object.defineProperties(this, {
			cache: {value: {}},
		});
	}

	get bounds()
	{
		if('bounds' in this.cache)
		{
			return this.cache.bounds;
		}

		let xMin =  Infinity, yMin =  Infinity;
		let xMax = -Infinity, yMax = -Infinity;

		if(!this.map.linedefIndex[this.index])
		{
			return new Bounds({xMin:0, yMin:0, xMax:0, yMax:0});
		}

		for(const linedefId of this.map.linedefIndex[this.index])
		{
			const linedef = this.map.linedef(linedefId);
			const from = this.map.vertex(linedef.from);
			const to   = this.map.vertex(linedef.to);

			for(const vertex of [from, to])
			{
				xMin = Math.min(vertex.x, xMin);
				yMin = Math.min(vertex.y, yMin);

				xMax = Math.max(vertex.x, xMax);
				yMax = Math.max(vertex.y, yMax);
			}
		}

		this.cache.bounds = new Bounds({xMin, yMin, xMax, yMax});

		return this.cache.bounds;
	}
}

class Flat
{
	constructor({wad, index, pos, size, name})
	{
		this.wad   = wad;
		this.index = index;
		this.pos   = pos;
		this.size  = size;
		this.name  = name;
		this.url   = null;
		this.animation = null;

		const prefix = name.replace(/\d+$/, '');

		if(this.wad.flatAnim[prefix])
		{
			this.animation = prefix;

		}
	}

	decode(lightLevel = 0)
	{
		if(this.decoding)
		{
			return this.decoding;
		}

		return this.decoding = this.decodeAsync(lightLevel);
	}

	async decodeAsync(lightLevel = 0)
	{
		if(this.url)
		{
			return this.url;
		}

		const colorMap = this.wad.getLumpByName('COLORMAP');
		const playPal  = this.wad.getLumpByName('PLAYPAL');

		const canvas  = new OffscreenCanvas(64, 64);
		const context = canvas.getContext('2d');
		const pixels  = context.getImageData(0, 0, canvas.width, canvas.height);

		const data = this.wad.lump(this.index);

		for(let i = 0; i < data.length; i++)
		{
			const o = data[i];
			const c = colorMap[o + lightLevel * 0x100];
			const x = i % 64;
			const y = Math.trunc(i / 64);
			const p = (x + (63-y) * 64) * 4;

			pixels.data[p + 0] = playPal[3 * c + 0];
			pixels.data[p + 1] = playPal[3 * c + 1];
			pixels.data[p + 2] = playPal[3 * c + 2];
			pixels.data[p + 3] = 255;
		}

		context.putImageData(pixels, 0, 0);
		// context.setTransform(1,0,0, -1,0,0);
		// context.drawImage(canvas, 0, 0);
		// context.setTransform(1,0,0, 1,0,0);

		return this.url = new ResourceUrl(await canvas.convertToBlob());
	}
}

class Patch
{
	constructor({wad, index, pos, size, name})
	{
		this.wad   = wad;
		this.index = index;
		this.pos   = pos;
		this.size  = size;
		this.name  = name;
		this.decoded = null;
	}

	decodePost(offset)
	{
		const row    = this.wad.view.getUint8(offset + 0*BYTE);
		const height = this.wad.view.getUint8(offset + 1*BYTE);

		// next byte (offset + 2*BYTE) is UNUSED.
		const pixels = this.wad.bytes.slice(offset + 3*BYTE, offset + 3*BYTE + height);

		// last byte is UNUSED.
		const length = 3*BYTE + height*BYTE + 1*BYTE;

		return {row, height, pixels, length};
	}

	decode(lightLevel = 0)
	{
		if(this.decoded)
		{
			return this.decoded;
		}

		const colorMap = this.wad.getLumpByName('COLORMAP');
		const playPal  = this.wad.getLumpByName('PLAYPAL');

		const width    = this.wad.view.getInt16(this.pos + 0*SHORT, true);
		const height   = this.wad.view.getInt16(this.pos + 1*SHORT, true);
		const leftOff  = this.wad.view.getInt16(this.pos + 2*SHORT, true);
		const topOff   = this.wad.view.getInt16(this.pos + 3*SHORT, true);

		const canvas  = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d');

		const decoded = context.getImageData(0, 0, width, height);

		let column = 0;
		const start = this.pos + 4*SHORT + 4*width;
		for(let i = start; i < this.pos + this.size; i)
		{
			const post = this.decodePost(i);

			for(const j in post.pixels)
			{
				const x = column;
				const y = post.row + Number(j);
				const p = 4 * (x + y * width);

				const o = post.pixels[j];
				const c = colorMap[o + lightLevel * 0x100];

				decoded.data[p + 0] = playPal[3 * c + 0];
				decoded.data[p + 1] = playPal[3 * c + 1];
				decoded.data[p + 2] = playPal[3 * c + 2];
				decoded.data[p + 3] =
					(decoded.data[p + 0] === 0x00 && decoded.data[p + 1] === 0xFF && decoded.data[p + 2] === 0xFF)
						? 0x00
						: 0xFF;
			}

			i += post.length;
			if(0xFF === this.wad.view.getUint8(i, true))
			{
				column++;
				i++;
			}
		}

		return this.decoded = decoded;
	}
}

class Picture
{
	constructor({wad, index, pos, size, name})
	{
		this.wad   = wad;
		this.index = index;
		this.pos   = pos;
		this.size  = size;
		this.name  = name;
	}

	decode()
	{
		if(this.decoding)
		{
			return this.decoding;
		}

		return this.decoding = this.decodeAsync();
	}

	async decodeAsync()
	{
		const width = this.wad.view.getInt16(this.pos + 0*SHORT, true);
		const height = this.wad.view.getInt16(this.pos + 1*SHORT, true);
		const canvas = new OffscreenCanvas(width, height);
		const patch = new Patch(this);
		canvas.getContext('2d').putImageData(patch.decode(), 0, 0);
		return new ResourceUrl(await canvas.convertToBlob());
	}
}

class Texture
{
	constructor({wad, name, width, height, patches})
	{
		this.wad     = wad;
		this.name    = name;
		this.width   = width;
		this.height  = height;
		this.animation = null;
		this.patches = patches;

		const prefix = name.replace(/\d+$/, '');

		if(this.wad.texAnim[prefix])
		{
			this.animation = prefix;
		}
	}

	decode(lightLevel = 0)
	{
		if(this.decoding)
		{
			return this.decoding;
		}

		return this.decoding = this.decodeAsync(lightLevel);
	}

	async decodeAsync(lightLevel = 0)
	{
		if(this.decoding)
		{
			return this.decoding;
		}

		const canvas = new OffscreenCanvas(this.width, this.height);
		const context = canvas.getContext('2d');

		for(const patchRef of this.patches)
		{
			const patch = new Patch({wad:this.wad, ...this.wad.getEntryByName(patchRef.pname)});
			const decoded = await createImageBitmap(patch.decode(lightLevel));
			context.drawImage(decoded, Math.max(0, patchRef.xOff), Math.max(0, patchRef.yOff));
		}

		return new ResourceUrl(await canvas.convertToBlob());
	}
}

class WadMap
{
	constructor(lumps, wad)
	{
		this.name = lumps.HEADER.name;

		Object.defineProperties(this, {
			lumps: {value: lumps, enumerable: true},
			wad:   {value: wad},
			cache: {value: {}},
			bsp:   {value: []},
			linedefIndex: {value: {}},
			glssectIndex: {value: {}},
			stitched: {value: new Map},
		});

		for(let i = 0; i < this.linedefCount; i++)
		{
			const linedef = this.linedef(i);
			const sidedef = this.sidedef(linedef.right);

			if(!this.linedefIndex[sidedef.sector])
			{
				this.linedefIndex[sidedef.sector] = new Set;
			}

			this.linedefIndex[sidedef.sector].add(i);
		}

		for(let i = 0; i < this.glSubsectorCount; i++)
		{
			const glSubsector = this.glSubsector(i);

			if(!this.glssectIndex[glSubsector.sector])
			{
				this.glssectIndex[glSubsector.sector] = new Set;
			}

			this.glssectIndex[glSubsector.sector].add(i);
		}

		for(let i = 0; i < this.glNodeCount; i++)
		{
			this.bsp.push(this.glNode(i))
		}

		const stitchWarnings = [];

		for(let i = 0; i < this.glSegCount; i++)
		{
			const seg = this.glSeg(i);

			if(seg.linedef < 0) continue;

			const from = seg.startIsGlVert ? this.glVert(seg.start) : this.vertex(seg.start);
			const to   = seg.endIsGlVert   ? this.glVert(seg.end)   : this.vertex(seg.end);

			const linedef = this.linedef(seg.linedef);
			const ldf = this.vertex(linedef.from);
			const ldt = this.vertex(linedef.to);

			const glVerts = [];

			if(seg.startIsGlVert) glVerts.push(from);
			if(seg.endIsGlVert)   glVerts.push(to);

			for(const vertex of glVerts)
			{
				const nearest = nearestPointOnLine(vertex.x, vertex.y, ldf.x, ldf.y, ldt.x, ldt.y);

				if(vertex.x === nearest.x && vertex.y === nearest.y) continue;

				stitchWarnings.push(`Stitching GLVert #${vertex.index} to Linedef #${linedef.index} (${vertex.x}, ${vertex.y})=>(${nearest.x}, ${nearest.y})!`);

				nearest.gl = false;
				nearest.virtual = true;

				this.stitched.set(vertex, nearest);
			}
		}

		if(stitchWarnings.length)
		{
			console.warn(`Stitched ${stitchWarnings.length} glVerts to linedefs.`);
		}

		Object.freeze(this);
	}

	get format()
	{
		if('format' in this.cache)
		{
			return this.cache.format;
		}

		for(const name of Object.keys(this.lumps))
		{
			if(name === 'BEHAVIOR')
			{
				return this.cache.format = 'HEXEN';
			}
		}

		return this.cache.format = 'DOOM';
	}

	get thingCount()
	{
		if(this.format === 'DOOM')
		{
			const THING_LEN =  5*SHORT;
			return Math.ceil(this.lumps.THINGS.size / THING_LEN);
		}
		else if(this.format === 'HEXEN')
		{
			const THING_LEN =  7*SHORT + 6*BYTE;
			return Math.ceil(this.lumps.THINGS.size / THING_LEN);
		}
	}

	thing(index)
	{
		if(!this.cache.thing)
		{
			this.cache.thing = new WeakerMap
		}

		if(this.cache.thing.has(index))
		{
			return this.cache.thing.get(index);
		}

		if(this.format === 'DOOM')
		{
			const THING_LEN  =  5*SHORT;
			const thingStart = this.lumps.THINGS.pos + THING_LEN * index;

			const x     = this.wad.view.getInt16(thingStart + 0*SHORT, true);
			const y     = this.wad.view.getInt16(thingStart + 1*SHORT, true);
			const angle = this.wad.view.getInt16(thingStart + 2*SHORT, true);
			const type  = this.wad.view.getInt16(thingStart + 3*SHORT, true);
			const flags = this.wad.view.getInt16(thingStart + 4*SHORT, true);

			const thing = {x, y, angle, type, flags, index};

			this.cache.thing.set(index, thing);

			return thing;
		}
		else if(this.format === 'HEXEN')
		{
			const THING_LEN  =  7*SHORT + 6*BYTE;
			const thingStart = this.lumps.THINGS.pos + THING_LEN * index;

			const id      = this.wad.view.getUint16(thingStart + 0*SHORT, true);
			const x       =  this.wad.view.getInt16(thingStart + 1*SHORT, true);
			const y       =  this.wad.view.getInt16(thingStart + 2*SHORT, true);
			const z       =  this.wad.view.getInt16(thingStart + 3*SHORT, true);
			const angle   = this.wad.view.getUint16(thingStart + 4*SHORT, true);
			const type    = this.wad.view.getUint16(thingStart + 5*SHORT, true);
			const flags   = this.wad.view.getUint16(thingStart + 6*SHORT, true);

			const special =  this.wad.view.getUint8(thingStart + 7*SHORT + 0*BYTE, true);
			const arg1    =  this.wad.view.getUint8(thingStart + 7*SHORT + 1*BYTE, true);
			const arg2    =  this.wad.view.getUint8(thingStart + 7*SHORT + 2*BYTE, true);
			const arg3    =  this.wad.view.getUint8(thingStart + 7*SHORT + 3*BYTE, true);
			const arg4    =  this.wad.view.getUint8(thingStart + 7*SHORT + 4*BYTE, true);
			const arg5    =  this.wad.view.getUint8(thingStart + 7*SHORT + 5*BYTE, true);

			const thing = {id, x, y, z, angle, type, flags, special, arg1, arg2, arg3, arg4, arg5, index}

			this.cache.thing.set(index, thing);

			return thing;
		}
	}

	get linedefCount()
	{
		if(this.format === 'DOOM')
		{
			const LINEDEF_LEN = 7*SHORT;
			return Math.ceil(this.lumps.LINEDEFS.size / LINEDEF_LEN);
		}
		else if(this.format === 'HEXEN')
		{
			const LINEDEF_LEN = 3*SHORT + 6*BYTE + 2*SHORT;
			return Math.ceil(this.lumps.LINEDEFS.size / LINEDEF_LEN);
		}
	}

	linedef(index)
	{
		if(!this.cache.linedef)
		{
			this.cache.linedef = new WeakerMap
		}

		if(this.cache.linedef.has(index))
		{
			return this.cache.linedef.get(index);
		}

		if(this.format === 'DOOM')
		{
			const LINEDEF_LEN =  7*SHORT;
			const linedefStart = this.lumps.LINEDEFS.pos + LINEDEF_LEN * index;

			const from  = this.wad.view.getUint16(linedefStart + 0*SHORT, true);
			const to    = this.wad.view.getUint16(linedefStart + 1*SHORT, true);
			const flags = this.wad.view.getUint16(linedefStart + 2*SHORT, true);
			const types = this.wad.view.getUint16(linedefStart + 3*SHORT, true);

			const tag   = this.wad.view.getUint16(linedefStart + 4*SHORT, true);
			const right = this.wad.view.getUint16(linedefStart + 5*SHORT, true);
			const left  = this.wad.view.getUint16(linedefStart + 6*SHORT, true);

			const linedef = {
				from,
				to,
				flags,
				types,
				tag,
				right,
				left: left < 0xFFFF ? left : -1,
				index,
			};

			this.cache.linedef.set(index, linedef);

			return linedef;
		}
		else if(this.format === 'HEXEN')
		{
			const LINEDEF_LEN =  3*SHORT + 6*BYTE + 2*SHORT;
			const linedefStart = this.lumps.LINEDEFS.pos + LINEDEF_LEN * index;

			const from    = this.wad.view.getUint16(linedefStart + 0*SHORT, true);
			const to      = this.wad.view.getUint16(linedefStart + 1*SHORT, true);
			const flags   = this.wad.view.getUint16(linedefStart + 2*SHORT, true);

			const special =  this.wad.view.getUint8(linedefStart + 3*SHORT + 0*BYTE, true);
			const arg1    =  this.wad.view.getUint8(linedefStart + 3*SHORT + 1*BYTE, true);
			const arg2    =  this.wad.view.getUint8(linedefStart + 3*SHORT + 2*BYTE, true);
			const arg3    =  this.wad.view.getUint8(linedefStart + 3*SHORT + 3*BYTE, true);
			const arg4    =  this.wad.view.getUint8(linedefStart + 3*SHORT + 4*BYTE, true);
			const arg5    =  this.wad.view.getUint8(linedefStart + 3*SHORT + 5*BYTE, true);

			const right   = this.wad.view.getUint16(linedefStart + 3*SHORT + 6*BYTE + 0*SHORT, true);
			const left    = this.wad.view.getUint16(linedefStart + 3*SHORT + 6*BYTE + 1*SHORT, true);

			const linedef = {
				from,
				to,
				flags,
				right,
				left: left < 0xFFFF ? left : -1,
				special,
				arg1,
				arg2,
				arg3,
				arg4,
				arg5,
				index,
			};

			this.cache.linedef.set(index, linedef);

			return linedef;
		}
	}

	get sidedefCount()
	{
		return Math.ceil(this.lumps.SIDEDEFS.size / SIDEDEF_LEN);
	}

	sidedef(index)
	{
		if(!this.cache.sidedef)
		{
			this.cache.sidedef = new WeakerMap
		}

		if(this.cache.sidedef.has(index))
		{
			return this.cache.sidedef.get(index);
		}

		const sidedefStart = this.lumps.SIDEDEFS.pos + SIDEDEF_LEN * index;

		const xOffset = this.wad.view.getUint16(sidedefStart + 0*SHORT, true);
		const yOffset = this.wad.view.getUint16(sidedefStart + 1*SHORT, true);
		const upper   = decodeText(this.wad.bytes.slice(sidedefStart + 2*SHORT, sidedefStart + 2*SHORT + 8*CHAR));
		const lower   = decodeText(this.wad.bytes.slice(sidedefStart + 2*SHORT + 1*8*CHAR, sidedefStart + 2*SHORT + 2*8*CHAR));
		const middle  = decodeText(this.wad.bytes.slice(sidedefStart + 2*SHORT + 2*8*CHAR, sidedefStart + 2*SHORT + 3*8*CHAR));
		const sector  = this.wad.view.getUint16(sidedefStart + 2*SHORT + 3*8*CHAR, true);

		const sidedef = {xOffset, yOffset, upper, lower, middle, sector, index};

		this.cache.sidedef.set(index, sidedef);

		return sidedef;
	}

	get vertexCount()
	{
		return Math.ceil(this.lumps.VERTEXES.size / VERTEX_LEN);
	}

	vertex(index)
	{
		if(!this.cache.vertex)
		{
			this.cache.vertex = new WeakerMap
		}

		if(this.cache.vertex.has(index))
		{
			return this.cache.vertex.get(index);
		}

		const vertexStart = this.lumps.VERTEXES.pos + VERTEX_LEN * index;

		const x = this.wad.view.getInt16(vertexStart + 0*SHORT, true);
		const y = this.wad.view.getInt16(vertexStart + 1*SHORT, true);

		const vertex = {x, y, index, gl: false, virtual: false};

		this.cache.vertex.set(index, vertex);

		return vertex;
	}

	get segCount()
	{
		return Math.ceil(this.lumps.SEGS.size / VERTEX_LEN);
	}

	seg(index)
	{
		if(!this.cache.seg)
		{
			this.cache.seg = new WeakerMap
		}

		if(this.cache.seg.has(index))
		{
			return this.cache.seg.get(index);
		}

		const segStart = this.lumps.SEGS.pos + SEG_LEN * index;

		const start   = this.wad.view.getUint16(segStart + 0*SHORT, true);
		const end     = this.wad.view.getUint16(segStart + 1*SHORT, true);
		const angle   = this.wad.view.getUint16(segStart + 2*SHORT, true);
		const linedef = this.wad.view.getUint16(segStart + 3*SHORT, true);
		const dir     = this.wad.view.getUint16(segStart + 4*SHORT, true);
		const offset  = this.wad.view.getUint16(segStart + 5*SHORT, true);

		const seg = {start, end, angle, linedef: linedef < 0xFFFF ? linedef : -1, dir, offset, index};

		this.cache.seg.set(index, seg);

		return seg;
	}

	get subsectorCount()
	{
		return Math.ceil(this.lumps.SSECTORS.size / SSECTOR_LEN);
	}

	subsector(index)
	{
		if(!this.cache.subsector)
		{
			this.cache.subsector = new WeakerMap
		}

		if(this.cache.subsector.has(index))
		{
			return this.cache.subsector.get(index);
		}

		const subsectorStart = this.lumps.SSECTORS.pos + SSECTOR_LEN * index;

		const count = this.wad.view.getUint16(subsectorStart + 0*SHORT, true);
		const start = this.wad.view.getUint16(subsectorStart + 1*SHORT, true);

		const subsector = {count, start};

		this.cache.subsector.get(index, subsector);

		return subsector;
	}

	get nodeCount()
	{
		return Math.ceil(this.lumps.NODES.size / NODE_LEN);
	}

	node(index)
	{
		if(!this.cache.node)
		{
			this.cache.node = new WeakerMap
		}

		if(this.cache.node.has(index))
		{
			return this.cache.node.get(index);
		}

		const nodeStart = this.lumps.NODES.pos + NODE_LEN * index;

		const x  = this.wad.view.getInt16(nodeStart + 0*SHORT, true);
		const y  = this.wad.view.getInt16(nodeStart + 1*SHORT, true);
		const dx = this.wad.view.getInt16(nodeStart + 2*SHORT, true);
		const dy = this.wad.view.getInt16(nodeStart + 3*SHORT, true);

		const right = {};
		const left  = {};

		right.yUpper = this.wad.view.getInt16(nodeStart + 4*SHORT, true);
		right.yLower = this.wad.view.getInt16(nodeStart + 5*SHORT, true);
		right.xUpper = this.wad.view.getInt16(nodeStart + 6*SHORT, true);
		right.xLower = this.wad.view.getInt16(nodeStart + 7*SHORT, true);

		left.yUpper  = this.wad.view.getInt16(nodeStart + 8*SHORT, true);
		left.yLower  = this.wad.view.getInt16(nodeStart + 9*SHORT, true);
		left.xUpper  = this.wad.view.getInt16(nodeStart + 10*SHORT, true);
		left.xLower  = this.wad.view.getInt16(nodeStart + 11*SHORT, true);

		right.child = this.wad.view.getUint16(nodeStart + 12*SHORT, true);
		left.child  = this.wad.view.getUint16(nodeStart + 13*SHORT, true);

		right.subsector = false;
		left.subsector  = false;

		if(right.child & 1<<15)
		{
			right.child ^= 1<<15;
			right.subsector = true;
		}

		if(left.child & 1<<15)
		{
			left.child ^= 1<<15;
			left.subsector = true;
		}

		const node = {x, y, dx, dy, right, left, index};

		this.cache.node.get(index, node);

		return node;
	}

	get sectorCount()
	{
		return Math.ceil(this.lumps.SECTORS.size / SECTOR_LEN);
	}

	sector(index)
	{
		if(!this.cache.sector)
		{
			this.cache.sector = new WeakerMap
		}

		if(this.cache.sector.has(index))
		{
			return this.cache.sector.get(index);
		}

		const sectorStart = this.lumps.SECTORS.pos + SECTOR_LEN * index;

		const floorHeight   = this.wad.view.getInt16(sectorStart + 0*SHORT, true);
		const ceilingHeight = this.wad.view.getInt16(sectorStart + 1*SHORT, true);
		const floorFlat     = decodeText(this.wad.bytes.slice(sectorStart + 2*SHORT + 0*8*CHAR, sectorStart + 2*SHORT + 1*8*CHAR));
		const ceilingFlat   = decodeText(this.wad.bytes.slice(sectorStart + 2*SHORT + 1*8*CHAR, sectorStart + 2*SHORT + 2*8*CHAR));
		const lightLevel    = this.wad.view.getUint16(sectorStart + 2*SHORT + 2*8*CHAR + 0*SHORT, true);
		const special       = this.wad.view.getUint16(sectorStart + 2*SHORT + 2*8*CHAR + 1*SHORT, true);
		const tag           = this.wad.view.getUint16(sectorStart + 2*SHORT + 2*8*CHAR + 2*SHORT, true);

		const sector = new Sector({
			floorHeight,
			ceilingHeight,
			floorFlat,
			ceilingFlat,
			lightLevel,
			special,
			tag,
			index,
			map: this,
		});

		this.cache.sector.set(index, sector);

		return sector;
	}

	get blockmapOrigin()
	{
		const entry = this.lumps.BLOCKMAP;
		const x = this.wad.view.getInt16(entry.pos + 0*SHORT, true);
		const y = this.wad.view.getInt16(entry.pos + 1*SHORT, true);

		return {x, y};
	}

	get blockCount()
	{
		const entry = this.lumps.BLOCKMAP;
		const cols  = this.wad.view.getUint16(entry.pos + 2*SHORT, true);
		const rows  = this.wad.view.getUint16(entry.pos + 3*SHORT, true);

		return cols * rows;
	}

	block(index)
	{
		const entry = this.lumps.BLOCKMAP;
		const start = this.wad.view.getUint16(entry.pos + 4*SHORT + index*SHORT, true);
		const linedefs = [];

		for(let i = 0;; i++)
		{
			const linedef = this.wad.view.getUint16(entry.pos + SHORT*start + i*SHORT, true);

			if(i === 0 && linedef === 0)
			{
				continue;
			}

			if(linedef === 0xFFFF)
			{
				break;
			}

			linedefs.push(linedef);
		}

		return linedefs;
	}

	blockForPoint(x, y)
	{
		const entry = this.lumps.BLOCKMAP;

		const xOrigin =  this.wad.view.getInt16(entry.pos + 0*SHORT, true);
		const yOrigin =  this.wad.view.getInt16(entry.pos + 1*SHORT, true);
		const columns = this.wad.view.getUint16(entry.pos + 2*SHORT, true);

		const xBlock = Math.trunc((x + -8 + -xOrigin) / 128);
		const yBlock = Math.trunc((y + -8 + -yOrigin) / 128);

		const index  = xBlock + yBlock * columns;

		return this.block(index);
	}

	// REJECT
	// BEHAVIOR
	// SCRIPTS

	get glVertVersion()
	{
		if('glVertVersion' in this.cache)
		{
			return this.cache.glVertVersion;
		}

		if(!this.lumps.GL_VERT)
		{
			return this.cache.glVertVersion = 0;
		}

		const glVertStart = this.lumps.GL_VERT.pos;
		const magic = decodeText(this.wad.bytes.slice(glVertStart, glVertStart + 4*CHAR));

		if(magic.substr(0, 3) !== 'gNd')
		{
			return this.cache.glVertVersion = 1;
		}

		return this.cache.glVertVersion = Number( magic.substr(3) );
	}

	get glVertCount()
	{
		if(!this.lumps.GL_VERT)
		{
			return 0;
		}

		if(this.glVertVersion < 3)
		{
			const GL_VERT_LEN = VERTEX_LEN;

			return Math.ceil(this.lumps.GL_VERT.size / GL_VERT_LEN);
		}
		else
		{
			const GL_VERT_LEN = 2*INT;

			return Math.ceil((-4 + this.lumps.GL_VERT.size) / GL_VERT_LEN);
		}
	}

	glVert(index)
	{
		if(!this.lumps.GL_VERT)
		{
			return 0;
		}

		if(!this.cache.glVert)
		{
			this.cache.glVert = new WeakerMap
		}

		if(this.cache.glVert.has(index))
		{
			return this.cache.glVert.get(index);
		}

		if(this.glVertVersion < 2)
		{
			const GL_VERT_LEN = VERTEX_LEN;
			const glVertexStart = this.lumps.GL_VERT.pos + GL_VERT_LEN * index;

			const x = this.wad.view.getInt16(glVertexStart + 0*SHORT, true);
			const y = this.wad.view.getInt16(glVertexStart + 1*SHORT, true);

			const glVert = {x, y, index, gl: true, virtual: false};

			this.cache.glVert.set(index, glVert);

			return glVert;
		}
		else if(this.glVertVersion < 3)
		{
			const GL_VERT_LEN = 2*INT;
			const glVertexStart = 4 + this.lumps.GL_VERT.pos + GL_VERT_LEN * index;

			const xLo = this.wad.view.getInt16(glVertexStart + 0*SHORT, true) / 0x10000;
			const xHi = this.wad.view.getInt16(glVertexStart + 1*SHORT, true);
			const yLo = this.wad.view.getInt16(glVertexStart + 2*SHORT, true) / 0x10000;
			const yHi = this.wad.view.getInt16(glVertexStart + 3*SHORT, true);

			const glVert = {x:xHi+xLo, y:yHi+yLo, index, gl: true, virtual: false};

			this.cache.glVert.set(index, glVert);

			return glVert;
		}
		else
		{
			const GL_VERT_LEN = 2*INT;
			const glVertexStart = 4 + this.lumps.GL_VERT.pos + GL_VERT_LEN * index;

			const x = this.wad.view.getInt32(glVertexStart + 0*INT, true) / 0xFFFF;
			const y = this.wad.view.getInt32(glVertexStart + 1*INT, true) / 0xFFFF;

			const glVert = {x, y, index, gl: true, virtual: false};

			this.cache.glVert.set(index, glVert);

			return glVert;
		}
	}

	get glSegVersion()
	{
		if('glSegVersion' in this.cache)
		{
			return this.cache.glSegVersion;
		}

		if(!this.lumps.GL_SEGS)
		{
			return this.cache.glSegVersion = 0;
		}

		const glSegStart = this.lumps.GL_SEGS.pos;
		const magic = decodeText(this.wad.bytes.slice(glSegStart, glSegStart + 4*CHAR));

		if(magic.substr(0, 3) !== 'gNd' && (this.glVertVersion < 3 || this.glVertVersion > 4))
		{
			return this.cache.glSegVersion = this.glVertVersion;
		}

		return this.cache.glSegVersion = Number( magic.substr(3) );
	}

	get glSegCount()
	{
		if(!this.lumps.GL_SEGS)
		{
			return 0;
		}

		if(this.glSegVersion < 3)
		{
			const GL_SEG_LEN = 5*SHORT;

			return Math.ceil(this.lumps.GL_SEGS.size / GL_SEG_LEN);
		}
		else if(this.glSegVersion < 5)
		{
			const GL_SEG_LEN = 2*INT + 2*SHORT + 1*INT;

			return Math.ceil((-4 + this.lumps.GL_SEGS.size) / GL_SEG_LEN);
		}
		else
		{
			const GL_SEG_LEN = 2*INT + 2*SHORT + 1*INT;

			return Math.ceil(this.lumps.GL_SEGS.size / GL_SEG_LEN);
		}
	}

	glSeg(index)
	{
		if(!this.lumps.GL_SEGS)
		{
			return 0;
		}

		if(!this.cache.glSeg)
		{
			this.cache.glSeg = new WeakerMap
		}

		if(this.cache.glSeg.has(index))
		{
			return this.cache.glSeg.get(index);
		}

		if(this.glSegVersion < 3)
		{
			const GL_SEG_LEN = 5*SHORT;
			const glSegStart = this.lumps.GL_SEGS.pos + GL_SEG_LEN * index;

			const start   = this.wad.view.getUint16(glSegStart + 0*SHORT, true);
			const end     = this.wad.view.getUint16(glSegStart + 1*SHORT, true);
			const linedef = this.wad.view.getUint16(glSegStart + 2*SHORT, true);
			const side    = this.wad.view.getUint16(glSegStart + 3*SHORT, true);
			const partner = this.wad.view.getUint16(glSegStart + 4*SHORT, true);

			const glSeg = {
				start: start & ~(1 << 15),
				end: end & ~(1 << 15),
				startIsGlVert: !!(start & (1 << 15)),
				endIsGlVert: !!(end & (1 << 15)),
				linedef: linedef < 0xFFFF ? linedef : -1,
				side,
				partner,
				index,
			};

			this.cache.glSeg.get(index, glSeg);

			return glSeg;
		}
		else if(this.glSegVersion < 5)
		{
			const GL_SEG_LEN = 2*INT + 2*SHORT + 1*INT;
			const glSegStart = 4 + this.lumps.GL_SEGS.pos + GL_SEG_LEN * index;

			const start   = this.wad.view.getUint32(glSegStart + 0*INT, true);
			const end     = this.wad.view.getUint32(glSegStart + 1*INT, true);
			const linedef = this.wad.view.getUint16(glSegStart + 2*INT + 0*SHORT, true);
			const side    = this.wad.view.getUint16(glSegStart + 2*INT + 1*SHORT, true);
			const partner = this.wad.view.getUint32(glSegStart + 2*INT + 2*SHORT, true);

			const glSeg = {
				start: start & ~(1 << 30),
				end: end & ~(1 << 30),
				startIsGlSeg: !!(start & (1 << 30)),
				endIsGlSeg: !!(end & (1 << 30)),
				linedef,
				side,
				partner,
				index,
			};

			this.cache.glSeg.get(index, glSeg);

			return glSeg;
		}
		else
		{
			const GL_SEG_LEN = 2*INT + 2*SHORT + 1*INT;
			const glSegStart = this.lumps.GL_SEGS.pos + GL_SEG_LEN * index;

			const start   = this.wad.view.getUint32(glSegStart + 0*INT, true);
			const end     = this.wad.view.getUint32(glSegStart + 1*INT, true);
			const linedef = this.wad.view.getUint16(glSegStart + 2*INT + 0*SHORT, true);
			const side    = this.wad.view.getUint16(glSegStart + 2*INT + 1*SHORT, true);
			const partner = this.wad.view.getUint32(glSegStart + 2*INT + 2*SHORT, true);

			const glSeg = {
				start: start & ~(1 << 31),
				end: end & ~(1 << 31),
				startIsGlSeg: !!(start & (1 << 31)),
				endIsGlSeg: !!(end & (1 << 31)),
				linedef,
				side,
				partner,
				index,
			};

			this.cache.glSeg.get(index, glSeg);

			return glSeg;
		}
	}

	get glSubsectVersion()
	{
		if('glSubsectVersion' in this.cache)
		{
			return this.cache.glSubsectVersion;
		}

		if(!this.lumps.GL_SSECT)
		{
			return this.cache.glSubsectVersion = 0;
		}

		const glSubsectStart = this.lumps.GL_SSECT.pos;
		const magic = decodeText(this.wad.bytes.slice(glSubsectStart, glSubsectStart + 4*CHAR));

		if(magic.substr(0, 3) !== 'gNd' && (this.glVertVersion < 3 || this.glVertVersion > 4))
		{
			return this.cache.glSubsectVersion = this.glVertVersion;
		}

		return this.cache.glSubsectVersion = Number( magic.substr(3) );
	}

	get glSubsectorCount()
	{
		if(!this.lumps.GL_SSECT)
		{
			return 0;
		}

		if(this.glSegVersion < 3)
		{
			const GL_SSECT_LEN = 2*SHORT;

			return Math.ceil(this.lumps.GL_SSECT.size / GL_SSECT_LEN);
		}
		else if(this.glSegVersion < 5)
		{
			const GL_SSECT_LEN = 2*INT;

			return Math.ceil((-4 + this.lumps.GL_SSECT.size) / GL_SSECT_LEN);
		}
		else
		{
			const GL_SSECT_LEN = 2*INT;

			return Math.ceil(this.lumps.GL_SSECT.size / GL_SSECT_LEN);
		}
	}

	glSubsector(index)
	{
		if(!this.lumps.GL_SSECT)
		{
			return 0;
		}

		if(this.glSubsectVersion < 3)
		{
			const GL_SSECT_LEN = 2*SHORT;
			const glSubsectStart = this.lumps.GL_SSECT.pos + GL_SSECT_LEN * index;

			const count = this.wad.view.getUint16(glSubsectStart + 0*SHORT, true);
			const first = this.wad.view.getUint16(glSubsectStart + 1*SHORT, true);

			return new GlSubsector({map: this, count, first, index});
		}
		else if(this.glSubsectVersion < 5)
		{
			const GL_SSECT_LEN = 2*INT;
			const glSubsectStart = 4 + this.lumps.GL_SSECT.pos + GL_SSECT_LEN * index;

			const count = this.wad.view.getUint32(glSubsectStart + 0*INT, true);
			const first = this.wad.view.getUint32(glSubsectStart + 1*INT, true);

			return new GlSubsector({map: this, count, first, index});
		}
		else
		{
			const GL_SSECT_LEN = 2*INT;
			const glSubsectStart = this.lumps.GL_SSECT.pos + GL_SSECT_LEN * index;

			const count = this.wad.view.getUint32(glSubsectStart + 0*INT, true);
			const first = this.wad.view.getUint32(glSubsectStart + 1*INT, true);

			return new GlSubsector({map: this, count, first, index});
		}
	}

	get glNodeVersion()
	{
		if('glNodeVersion' in this.cache)
		{
			return this.cache.glNodeVersion;
		}

		if(!this.lumps.GL_NODES)
		{
			return this.cache.glNodeVersion = 0;
		}

		const glNodeStart = this.lumps.GL_NODES.pos;
		const magic = decodeText(this.wad.bytes.slice(glNodeStart, glNodeStart + 4*CHAR));

		if(magic.substr(0, 3) !== 'gNd' && (this.glVertVersion < 3 || this.glVertVersion > 4))
		{
			return this.cache.glNodeVersion = this.glVertVersion;
		}

		return this.cache.glNodeVersion = Number( magic.substr(3) );
	}

	get glNodeCount()
	{
		if(!this.lumps.GL_NODES)
		{
			return 0;
		}

		if(this.glSegVersion < 5)
		{
			const GL_NODE_LEN = NODE_LEN;

			return Math.ceil(this.lumps.GL_NODES.size / GL_NODE_LEN);
		}
		else
		{
			const GL_NODE_LEN = 12*SHORT + 2*INT;

			return Math.ceil(this.lumps.GL_NODES.size / GL_NODE_LEN);
		}
	}

	glNode(index)
	{
		if(!this.lumps.GL_NODES)
		{
			return 0;
		}

		if(this.glNodeVersion < 5)
		{
			const GL_NODE_LEN = NODE_LEN;
			const glNodeStart = this.lumps.GL_NODES.pos + GL_NODE_LEN * index;

			const x   = this.wad.view.getInt16(glNodeStart + 0*SHORT, true);
			const y   = this.wad.view.getInt16(glNodeStart + 1*SHORT, true);
			const dx  = this.wad.view.getInt16(glNodeStart + 2*SHORT, true);
			const dy  = this.wad.view.getInt16(glNodeStart + 3*SHORT, true);

			const right = {};
			const left  = {};

			right.yUpper = this.wad.view.getInt16(glNodeStart + 4*SHORT, true);
			right.yLower = this.wad.view.getInt16(glNodeStart + 5*SHORT, true);
			right.xUpper = this.wad.view.getInt16(glNodeStart + 6*SHORT, true);
			right.xLower = this.wad.view.getInt16(glNodeStart + 7*SHORT, true);

			left.yUpper = this.wad.view.getInt16(glNodeStart + 8*SHORT, true);
			left.yLower = this.wad.view.getInt16(glNodeStart + 9*SHORT, true);
			left.xUpper = this.wad.view.getInt16(glNodeStart + 10*SHORT, true);
			left.xLower = this.wad.view.getInt16(glNodeStart + 11*SHORT, true);

			right.child = this.wad.view.getUint16(glNodeStart + 12*SHORT, true);
			left.child  = this.wad.view.getUint16(glNodeStart + 13*SHORT, true);

			right.subsector = false;
			left.subsector  = false;

			if(right.child & 1<<15)
			{
				right.child ^= 1<<15;
				right.subsector = true;
			}

			if(left.child & 1<<15)
			{
				left.child ^= 1<<15;
				left.subsector = true;
			}

			return new GlNode({map: this, x, y, dx, dy, right, left, index});
		}
		else
		{
			const GL_NODE_LEN = 12*SHORT + 2*INT;
			const glNodeStart = this.lumps.GL_NODES.pos + GL_NODE_LEN * index;

			const x   = this.wad.view.getInt16(glNodeStart + 0*SHORT, true);
			const y   = this.wad.view.getInt16(glNodeStart + 1*SHORT, true);
			const dx  = this.wad.view.getInt16(glNodeStart + 2*SHORT, true);
			const dy  = this.wad.view.getInt16(glNodeStart + 3*SHORT, true);

			const right = {};
			const left = {};

			right.yUpper = this.wad.view.getInt16(glNodeStart + 4*SHORT, true);
			right.yLower = this.wad.view.getInt16(glNodeStart + 5*SHORT, true);
			right.xUpper = this.wad.view.getInt16(glNodeStart + 6*SHORT, true);
			right.xLower = this.wad.view.getInt16(glNodeStart + 7*SHORT, true);

			left.yUpper = this.wad.view.getInt16(glNodeStart + 8*SHORT, true);
			left.yLower = this.wad.view.getInt16(glNodeStart + 9*SHORT, true);
			left.xUpper = this.wad.view.getInt16(glNodeStart + 10*SHORT, true);
			left.xLower = this.wad.view.getInt16(glNodeStart + 11*SHORT, true);

			right.child = this.wad.view.getUint32(glNodeStart + 11*SHORT + 0*INT, true);
			left.child  = this.wad.view.getUint32(glNodeStart + 11*SHORT + 1*INT, true);

			right.subsector = false;
			left.subsector  = false;

			if(right.child & 1<<31)
			{
				right.child ^= 1<<31;
				right.subsector = true;
			}

			if(left.child & 1<<31)
			{
				left.child ^= 1<<31;
				left.subsector = true;
			}

			return new GlNode({map: this, x, y, dx, dy, right, left, index});
		}
	}

	// GL_PVS
	// WADCSRC

	get bounds()
	{
		if('bounds' in this.cache)
		{
			return this.cache.bounds;
		}

		let xMin =  Infinity, yMin =  Infinity;
		let xMax = -Infinity, yMax = -Infinity;

		for(let i = 0; i < this.vertexCount; i++)
		{
			const vertex = this.vertex(i);

			xMin = Math.min(vertex.x, xMin);
			yMin = Math.min(vertex.y, yMin);

			xMax = Math.max(vertex.x, xMax);
			yMax = Math.max(vertex.y, yMax);
		}

		return this.cache.bounds = new Bounds({xMin, yMin, xMax, yMax});
	}

	dump()
	{
		const things = [];
		for(let i = 0; i < this.thingCount; i++)
		{
			things.push( this.thing(i) );
		}

		const linedefs = [];
		for(let i = 0; i < this.linedefCount; i++)
		{
			linedefs.push( this.linedef(i) );
		}

		const sidedefs = [];
		for(let i = 0; i < this.sidedefCount; i++)
		{
			sidedefs.push( this.linedef(i) );
		}

		const vertexes = [];
		for(let i = 0; i < this.vertexCount; i++)
		{
			vertexes.push( this.vertex(i) );
		}

		const segs = [];
		for(let i = 0; i < this.segCount; i++)
		{
			segs.push( this.seg(i) );
		}

		const subsectors = [];
		for(let i = 0; i < this.subsectorCount; i++)
		{
			subsectors.push( this.subsector(i) );
		}

		const nodes = [];
		for(let i = 0; i < this.nodeCount; i++)
		{
			nodes.push( this.node(i) );
		}

		const sectors = [];
		for(let i = 0; i < this.sectorCount; i++)
		{
			sectors.push( this.sector(i) );
		}

		const glVerts = [];
		for(let i = 0; i < this.glVertCount; i++)
		{
			glVerts.push( this.glVert(i) );
		}

		const glSegs = [];
		for(let i = 0; i < this.glSegCount; i++)
		{
			glSegs.push( this.glSeg(i) );
		}

		const glSubsects = [];
		for(let i = 0; i < this.glSubsectCount; i++)
		{
			glSubsects.push( this.glSubsector(i) );
		}

		const glNodes = [];
		for(let i = 0; i < this.glNodeCount; i++)
		{
			glNodes.push( this.glNode(i) );
		}

		return {
			things, linedefs, sidedefs, vertexes, segs, subsectors, nodes, sectors,
			glVerts, glSegs, glSubsects, glNodes
		};
	}

	bspPoint(x, y)
	{
		const root = this.bsp[ this.bsp.length + -1 ];
		let parent = root;

		for(let i = 0; i < 0xFF; i++)
		{
			const dx = x - parent.x;
			const dy = y - parent.y;

			const isBehind = dx * parent.dy - dy * parent.dx <= 0;

			if(isBehind)
			{
				if(parent.left.subsector)
				{
					const subsector = this.glSubsector(parent.left.child);
					const sector = this.sector(subsector.sector);
					return sector;
				}

				parent = this.bsp[ parent.left.child ];
			}
			else
			{
				if(parent.right.subsector)
				{
					const subsector = this.glSubsector(parent.right.child);
					const sector = this.sector(subsector.sector);
					return sector;
				}

				parent = this.bsp[ parent.right.child ];
			}
		}
	}
}

export class Wad
{
	constructor(byteArray)
	{
		Object.defineProperty(this, 'bytes', {value: new Uint8Array(byteArray)});
		Object.defineProperty(this, 'view', {value: new DataView(this.bytes.buffer)});
		Object.defineProperty(this, 'cache', {value: {}});
		Object.defineProperty(this, 'entries', {value: {}});
		Object.defineProperty(this, 'lumps', {value: {}});
		Object.defineProperty(this, 'patches', {value: {}});
		Object.defineProperty(this, 'textures', {value: {}});
		Object.defineProperty(this, 'flats', {value: {}});
		Object.defineProperty(this, 'texAnim', {value: {}});
		Object.defineProperty(this, 'flatAnim', {value: {}});
		Object.defineProperty(this, 'sprites', {value: {}});
		Object.defineProperty(this, 'sounds', {value: {}});

		for(let i = 0; i < this.lumpCount; i++)
		{
			const entry = this.getDirEntry(i);
			this.entries[entry.name] = entry;
			this.lumps[entry.name] = this.lump(i);
		}

		this.loadFlats();
		this.loadPatches();
		this.loadSprites();
		this.loadTextures();
		this.loadAnimations();

		Object.freeze(this.bytes.buffer);
		Object.freeze(this);
	}

	get type()
	{
		if('type' in this.cache)
		{
			return this.cache.type;
		}

		return this.cache.type = dec.decode(this.bytes.slice(0, 4));
	}

	get format()
	{
		if('format' in this.cache)
		{
			return this.cache.format;
		}

		for(let i = 0; i < this.lumpCount; i++)
		{
			const entry = this.getDirEntry(i);

			if(entry.name === 'MAINCFG')
			{
				return this.cache.format = 'SRB2';
			}
		}

		return this.cache.format = 'DOOM/HEXEN';
	}

	get info()
	{
		const entry = this.getEntryByName('WADINFO');

		if(entry)
		{
			return decodeText(this.lump(entry.index));
		}
	}

	get lumpCount()
	{
		return this.view.getUint32(4, true);
	}

	getDirEntry(index)
	{
		const dirStart = this.view.getUint32(8, true);
		const entryStart = dirStart + index * DIR_ENTRY_LEN;

		const pos = this.view.getUint32(entryStart, true);
		const size = this.view.getUint32(entryStart + 4, true);

		const nameStart = entryStart + 8;

		const name = decodeText(this.bytes.slice(nameStart, nameStart + 8));

		return {wad: this, index, pos, size, name};
	}

	getEntryByName(name)
	{
		return this.entries[name];
	}

	getLumpByName(name)
	{
		const entry = this.getEntryByName(name);

		if(!name)
		{
			return null;
		}

		return this.lump(entry.index);
	}

	lump(index)
	{
		const entry = this.getDirEntry(index);
		return this.bytes.slice(entry.pos, entry.pos + entry.size);
	}

	findMaps()
	{
		const maps = [];

		for(let i = 1; i < this.lumpCount + -3; i++)
		{
			const entry = this.getDirEntry(i);

			if(entry.size > 0)
			{
				continue;
			}

			const next1 = this.getDirEntry(i + 1);
			const next2 = this.getDirEntry(i + 2);
			const next3 = this.getDirEntry(i + 3);

			if(next1.name === MAP_LUMPS[0] && next2.name === MAP_LUMPS[1] && next3.name === MAP_LUMPS[2])
			{
				maps.push(entry.name);
			}
		}

		return maps;
	}

	loadMap(mapName)
	{
		const HEADER = this.getEntryByName(mapName);
		const entries = {HEADER};

		if(!HEADER)
		{
			return;
		}

		for(let i = 1 + HEADER.index; i < this.lumpCount; i++)
		{
			const entry = this.getDirEntry(i);

			if(!MAP_LUMPS.includes(entry.name) && entry.name !== ('GL_' + mapName).substr(0, 8))
			{
				break;
			}

			entries[ entry.name ] = entry;
		}

		return new WadMap(entries, this);
	}

	loadPatches()
	{
		let started = false;
		for(let i = 0; i < this.lumpCount; i++)
		{
			const entry = this.getDirEntry(i);
			// const lump = this.lump(i);

			if(entry.name === 'P_START')
			{
				started = true;
			}
			else if(entry.name === 'P_END')
			{
				started = false;
			}

			if(!started || entry.size === 0) continue;

			this.patches[entry.name] = entry;
		}
	}

	loadTextures()
	{
		const pnameEntry = this.getEntryByName('PNAMES');

		if(!pnameEntry)
		{
			return;
		}

		const count = this.view.getUint32(pnameEntry.pos, true);
		const pnames = [];

		for(let i = 0; i < count; i++)
		{
			const nameStart = pnameEntry.pos + 1*INT + i*8*BYTE;
			pnames.push( decodeText(this.bytes.slice(nameStart, nameStart + 8*BYTE)).toUpperCase() );
		}

		const texture1 = this.getEntryByName('TEXTURE1');
		const texture2 = this.getEntryByName('TEXTURE2');

		const textureEntries = [texture1];
		if(texture2) textureEntries.push(texture2);

		for(const textureEntry of textureEntries)
		{
			const count = this.view.getUint16(textureEntry.pos, true);

			for(let i = 0; i < count; i++)
			{
				const pointer = textureEntry.pos + this.view.getUint32(textureEntry.pos + 4 + i*INT, true);

				const name   = decodeText(this.bytes.slice(pointer, pointer + 8*BYTE));
				const width  = this.view.getUint16(pointer + 8*BYTE + 2*SHORT, true);
				const height = this.view.getUint16(pointer + 8*BYTE + 3*SHORT, true);
				const pCount = this.view.getUint16(pointer + 8*BYTE + 6*SHORT, true);

				const patches = [];
				for(let j = 0; j < pCount; j++)
				{
					const start    = pointer + 8*BYTE + 7*SHORT + j*5*SHORT;
					const xOff     = this.view.getInt16(start + 0*SHORT, true);
					const yOff     = this.view.getInt16(start + 1*SHORT, true);
					const index    = this.view.getUint16(start + 2*SHORT, true);
					const stepDir  = this.view.getUint16(start + 3*SHORT, true);
					const colorMap = this.view.getUint16(start + 4*SHORT, true);

					patches.push({xOff, yOff, index, pname:pnames[index], stepDir, colorMap});
				}

				this.textures[name] = {wad: this, name, width, height, patches};
			}
		}
	}

	loadFlats()
	{
		let started = false;

		for(let i = 0; i < this.lumpCount; i++)
		{
			const entry = this.getDirEntry(i);

			if(entry.name === 'F_START')
			{
				started = true;
			}
			else if(entry.name === 'F_END')
			{
				started = false;
			}

			if(!started || entry.size === 0) continue;

			this.flats[entry.name] = entry;
		}
	}

	loadSprites()
	{
		let started = false;

		for(let i = 0; i < this.lumpCount; i++)
		{
			const entry = this.getDirEntry(i);

			if(entry.name === 'S_START')
			{
				started = true;
			}
			else if(entry.name === 'S_END')
			{
				break;
			}

			if(!started || entry.size === 0) continue;

			this.sprites[entry.name] = entry;
		}
	}

	loadAnimations()
	{
		for(const textureName of Object.keys(this.textures))
		{
			const prefix = textureName.replace(/\d+$/, '');

			if(!defaultAnimatedTextures.has(prefix))
			{
				continue;
			}

			if(!this.texAnim[prefix])
			{
				this.texAnim[prefix] = [];
			}

			this.texAnim[prefix].push(textureName);
		}

		for(const flatName of Object.keys(this.flats))
		{
			const prefix = flatName.replace(/\d+$/, '');

			if(!defaultAnimatedFlats.has(prefix))
			{
				continue;
			}

			if(!this.flatAnim[prefix])
			{
				this.flatAnim[prefix] = [];
			}

			this.flatAnim[prefix].push(flatName);
		}
	}

	texture(name)
	{
		if(!this.cache.texture)
		{
			this.cache.texture = new Map;
		}

		if(this.cache.texture.has(name))
		{
			return this.cache.texture.get(name);
		}

		if(!this.textures[name])
		{
			return null;
		}

		const texture = new Texture(this.textures[name]);

		this.cache.texture.set(name, texture);

		return texture;
	}

	textureAnimation(name)
	{
		return this.texAnim[name];
	}

	flat(name)
	{
		if(!this.cache.flat)
		{
			this.cache.flat = new Map;
		}

		if(this.cache.flat.has(name))
		{
			return this.cache.flat.get(name);
		}

		if(!this.flats[name])
		{
			return null;
		}

		const flat = new Flat(this.flats[name]);

		this.cache.flat.set(name, flat);

		return flat;
	}

	flatAnimation(name)
	{
		return this.flatAnim[name];
	}

	sprite(name)
	{
		if(!this.sprites[name])
		{
			return null;
		}

		return new Picture(this.sprites[name]);
	}
}

export class WadLoader
{
	constructor(...byteArray)
	{
		const wads = byteArray.map(rawBytes => new Wad(rawBytes));
		this.wads = [...wads].reverse();

		if(wads[0].type !== 'IWAD')
		{
			console.warn(`Type of first .WAD is ${wads[0].type}, expected IWAD.`);
		}

		Object.freeze(this.wads);
		Object.freeze(this);
	}

	getDirEntry(index)
	{
		for(const wad of this.wads)
		{
			const entry = wad.getDirEntry(index);
			if(entry) return entry;
		}
	}

	getDirEntryByName(name)
	{
		for(const wad of this.wads)
		{
			const entry = wad.getDirEntryByName(name);
			if(entry) return entry;
		}
	}

	getLumpByName(name)
	{
		for(const wad of this.wads)
		{
			const lump = wad.getLumpByName(name);
			if(lump) return lump;
		}
	}

	lump(index)
	{
		for(const wad of this.wads)
		{
			const lump = wad.lump(index);
			if(lump) return lump;
		}
	}

	findMaps()
	{
		const maps = new Set;

		for(const wad of this.wads)
		{
			const wadMaps = wad.findMaps();
			wadMaps.forEach(map => maps.add(map));
		}

		return [...maps];
	}

	loadMap(mapName)
	{
		for(const wad of this.wads)
		{
			const map = wad.loadMap(mapName);
			if(map) return map;
		}
	}

	texture(name)
	{
		for(const wad of this.wads)
		{
			const texture = wad.texture(name);
			if(texture) return texture;
		}
	}

	textureAnimation(name)
	{
		for(const wad of this.wads)
		{
			const texture = wad.textureAnimation(name);
			if(texture) return texture;
		}
	}

	flat(name)
	{
		for(const wad of this.wads)
		{
			const flat = wad.flat(name);
			if(flat) return flat;
		}
	}

	flatAnimation(name)
	{
		for(const wad of this.wads)
		{
			const animation = wad.flatAnimation(name);
			if(animation) return animation;
		}
	}

	sprite()
	{
		for(const wad of this.wads)
		{
			const sprite = wad.sprite(name);
			if(sprite) return sprite;
		}
	}
}

const defaultAnimatedTextures = new Set([
	'BLODGR',
	'BLODRIP',
	'FIREBLU',
	'FIRELAV',
	'FIREMAG',
	'FIREWAL',
	'GSTFONT',
	'ROCKRED',
	'SLADRIP',
	'BFALL',
	'SFALL',
	'WFALL',
	'DBRAIN',
]);

const defaultAnimatedFlats = new Set([
	'NUKAGE',
	'FWATER',
	'SWATER',
	'LAVA',
	'BLOOD',
	'RROCK0',
	'SLIME0',
	'SLIME0',
	'SLIME0',
]);

