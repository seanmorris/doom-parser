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
	, 'GL_LEVEL'
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
		console.warn('Revoking ' + this.url);
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

			if(seg.linedef >= 0)
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
		this.animation = null;
		this.decoding = [];
		this.urls = [];

		const prefix = name.replace(/\d+$/, '');

		if(this.wad.flatAnim[prefix])
		{
			this.animation = prefix;

		}
	}

	decode(lightLevel = 0)
	{
		if(this.decoding[lightLevel])
		{
			return this.decoding[lightLevel];
		}

		return this.decoding[lightLevel] = this.decodeAsync(lightLevel);
	}

	async decodeAsync(lightLevel = 0)
	{
		if(this.decoding[lightLevel])
		{
			return this.decoding[lightLevel];
		}

		if(this.urls[lightLevel])
		{
			return this.urls[lightLevel];
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

		return this.urls[lightLevel] = new ResourceUrl(await canvas.convertToBlob());
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
		this.width = 0;
		this.height = 0;
		this.transparent = false;
	}

	decodePost(offset)
	{
		const row    = this.wad.view.getUint8(offset + 0*BYTE);
		const height = this.wad.view.getUint8(offset + 1*BYTE);
		const pixels = this.wad.bytes.slice(offset + 3*BYTE, offset + 3*BYTE + height);
		const length = 3*BYTE + height*BYTE + 1*BYTE;
		return {row, height, pixels, length};
	}

	async decode(lightLevel = 0)
	{
		if(this.decoded)
		{
			return this.decoded;
		}

		if(this.name === 'VOID')
		{
			const canvas  = new OffscreenCanvas(1, 1);
			const context = canvas.getContext('2d');
			return this.decoded = canvas;
		}

		const loader = this.wad.loader || this.wad;

		const colorMap = loader.getLumpByName('COLORMAP');
		const playPal  = loader.getLumpByName('PLAYPAL');

		const width    = this.wad.view.getInt16(this.pos + 0*SHORT, true);
		const height   = this.wad.view.getInt16(this.pos + 1*SHORT, true);
		const leftOff  = this.wad.view.getInt16(this.pos + 2*SHORT, true);
		const topOff   = this.wad.view.getInt16(this.pos + 3*SHORT, true);

		this.width  = width;
		this.height = height;

		if(width === 0x5089 && height == 0x474E)
		{
			console.warn(`Patch lump ${this.name} is a PNG, which is not yet supported.`);
			const blob = new Blob([this.wad.slice(this.pos, this.pos + this.length)], {'type': 'image/png'});
			const url  = new ResourceUrl(blob);
			const img  = new Image;
			img.src = url;
			const waiter = new Promise(a => img.onload = a);
			await waiter;

			const canvas  = new OffscreenCanvas(img.width, img.height);
			const context = canvas.getContext('2d');
			context.putImageData(decoded, 0, 0);
			return this.decoded = canvas;
		}

		const canvas  = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d');
		const decoded = context.getImageData(0, 0, width, height);

		let column = 0;
		const start = this.pos + 4*SHORT + 4*width;

		for(let i = start; column < width;)
		{
			if(0xFF === this.wad.view.getUint8(i, true))
			{
				column++;
				i++;
				continue;
			}

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
				decoded.data[p + 3] = 0xFF;
			}

			i += post.length;
		}

		context.putImageData(decoded, 0, 0);

		return this.decoded = canvas;
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
		this.width = 0;
		this.height = 0;
		this.url = [];
		this.decoding = [];
	}

	decode(lightLevel = 0)
	{
		if(this.decoding[lightLevel])
		{
			return this.decoding[lightLevel];
		}

		return this.decoding[lightLevel] = this.decodeAsync(lightLevel);
	}

	async decodeAsync(lightLevel = 0)
	{
		if(this.url[lightLevel])
		{
			return this.url[lightLevel];
		}

		const width = this.wad.view.getInt16(this.pos + 0*SHORT, true);
		const height = this.wad.view.getInt16(this.pos + 1*SHORT, true);
		if(width === 0x5089 && height == 0x474E)
		{
			// Lump is a PNG.
			// const blob = new Blob([this.wad.slice(this.pos, this.pos + this.length)], {'type': 'image/png'});
			console.warn(`Picture lump ${this.name} is a PNG, which is not yet supported.`);
			const canvas = new OffscreenCanvas(1, 1);
			canvas.getContext('2d');
			return this.url[lightLevel] = new ResourceUrl(await canvas.convertToBlob());
		}
		const canvas = new OffscreenCanvas(width, height);
		const patch = new Patch(this);
		this.width  = width;
		this.height = height;
		canvas.getContext('2d').drawImage(await patch.decode(lightLevel), 0, 0);
		return this.url[lightLevel] = new ResourceUrl(await canvas.convertToBlob());
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
		this.decoding = [];
		this.transparent = false;

		const prefix = name.replace(/\d+$/, '');

		if(this.wad.texAnim[prefix])
		{
			this.animation = prefix;
		}
	}

	decode(lightLevel = 0)
	{
		if(this.decoding[lightLevel])
		{
			return this.decoding[lightLevel];
		}

		return this.decoding[lightLevel] = this.decodeAsync(lightLevel);
	}

	async decodeAsync(lightLevel = 0)
	{
		if(this.decoding[lightLevel])
		{
			return this.decoding[lightLevel];
		}

		const canvas = new OffscreenCanvas(this.width, this.height);
		const context = canvas.getContext('2d');

		const loader = this.wad.loader || this.wad;

		for(const patchRef of this.patches)
		{
			const patch = new Patch({wad:this.wad, ...loader.getEntryByName(patchRef.pname)});
			if(!patch.name)
			{
				console.warn(`Missing patch ${patchRef.pname} for texture ${this.name}`);
				continue;
			}
			const decoded = await createImageBitmap(await patch.decode(lightLevel));
			context.drawImage(decoded, Math.max(0, patchRef.xOff), Math.max(0, patchRef.yOff));
		}

		const pixels = context.getImageData(0, 0, canvas.width, canvas.height);

		for(let i = 3; i < pixels.data.length; i+= 4)
		{
			if(pixels.data[i] < 0xFF)
			{
				this.transparent = true;
				break;
			}
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

		this.pos = Infinity;
		let end = 0;

		for(const lump of Object.values(this.lumps))
		{
			if(this.pos > lump.pos)
			{
				this.pos = lump.pos;
			}

			if(end < lump.pos + lump.size)
			{
				end = lump.pos + lump.size;
			}
		}

		this.size = end - this.pos;

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
			const meta  = thingTable[type];

			const diff0  = flags & (1<<0);
			const diff1  = flags & (1<<1);
			const diff2  = flags & (1<<2);
			const ambush = flags & (1<<3);
			const multip = flags & (1<<4);

			const flagsSplit = {diff0, diff1, diff2, ambush, multip};

			const thing = {x, y, angle, type, flags:flagsSplit, index, meta};

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

			const diff0   = flags & (1<<0);
			const diff1   = flags & (1<<1);
			const diff2   = flags & (1<<2);
			const ambush  = flags & (1<<3);
			const dormant = flags & (1<<4);
			const fighter = flags & (1<<5);
			const cleric  = flags & (1<<6);
			const mage    = flags & (1<<7);
			const single  = flags & (1<<8);
			const coop    = flags & (1<<9);
			const deathmatch = flags & (1<<10);

			const flagsSplit = {diff0, diff1, diff2, ambush, dormant, fighter, cleric, mage, single, coop, deathmatch}

			const special =  this.wad.view.getUint8(thingStart + 7*SHORT + 0*BYTE, true);
			const arg1    =  this.wad.view.getUint8(thingStart + 7*SHORT + 1*BYTE, true);
			const arg2    =  this.wad.view.getUint8(thingStart + 7*SHORT + 2*BYTE, true);
			const arg3    =  this.wad.view.getUint8(thingStart + 7*SHORT + 3*BYTE, true);
			const arg4    =  this.wad.view.getUint8(thingStart + 7*SHORT + 4*BYTE, true);
			const arg5    =  this.wad.view.getUint8(thingStart + 7*SHORT + 5*BYTE, true);
			const meta    = thingTable[type];

			const thing = {id, x, y, z, angle, type, flags:flagsSplit, special, arg1, arg2, arg3, arg4, arg5, index, meta}

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

			const from   = this.wad.view.getUint16(linedefStart + 0*SHORT, true);
			const to     = this.wad.view.getUint16(linedefStart + 1*SHORT, true);
			const flags  = this.wad.view.getUint16(linedefStart + 2*SHORT, true);
			const action = this.wad.view.getUint16(linedefStart + 3*SHORT, true);

			const tag    = this.wad.view.getUint16(linedefStart + 4*SHORT, true);
			const right  = this.wad.view.getUint16(linedefStart + 5*SHORT, true);
			const left   = this.wad.view.getUint16(linedefStart + 6*SHORT, true);

			const actionMeta = actionTable[action] ? {index: action, ...actionTable[action]} : null;
			if(actionMeta && actionMeta.sound) actionMeta.soundMeta = soundMapping[actionMeta.sound];

			const linedef = {
				index,
				from,
				to,
				flags,
				action,
				tag,
				right,
				left: left < 0xFFFF ? left : -1,
				actionMeta,
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

			const action  =  this.wad.view.getUint8(linedefStart + 3*SHORT + 0*BYTE, true);
			const arg1    =  this.wad.view.getUint8(linedefStart + 3*SHORT + 1*BYTE, true);
			const arg2    =  this.wad.view.getUint8(linedefStart + 3*SHORT + 2*BYTE, true);
			const arg3    =  this.wad.view.getUint8(linedefStart + 3*SHORT + 3*BYTE, true);
			const arg4    =  this.wad.view.getUint8(linedefStart + 3*SHORT + 4*BYTE, true);
			const arg5    =  this.wad.view.getUint8(linedefStart + 3*SHORT + 5*BYTE, true);

			const right   = this.wad.view.getUint16(linedefStart + 3*SHORT + 6*BYTE + 0*SHORT, true);
			const left    = this.wad.view.getUint16(linedefStart + 3*SHORT + 6*BYTE + 1*SHORT, true);

			const actionMeta = actionTableHexen[action];

			const linedef = {
				index,
				from,
				to,
				flags,
				right,
				left: left < 0xFFFF ? left : -1,
				action,
				arg1,
				arg2,
				arg3,
				arg4,
				arg5,
				actionMeta
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

		if(index < 0 || index >= this.blockCount)
		{
			return [];
		}

		return this.block(index);
	}

	blocksNearPoint(x, y)
	{
		return [...new Set([
			...this.blockForPoint(x, y),
			...this.blockForPoint(x + 0x80, y),
			...this.blockForPoint(x - 0x80, y),
			...this.blockForPoint(x, y + 0x80),
			...this.blockForPoint(x, y - 0x80),
			...this.blockForPoint(x + 0x80, y + 0x80),
			...this.blockForPoint(x - 0x80, y - 0x80),
			...this.blockForPoint(x + 0x80, y - 0x80),
			...this.blockForPoint(x - 0x80, y + 0x80),
		])];
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

	get hasPvs()
	{
		return !!(this.lumps.GL_PVS && this.lumps.GL_PVS.size);
	}

	glpvsIsVisible(from, to)
	{
		if(!this.lumps.GL_PVS)
		{
			console.warn('No GL_PVS node found.');
			return false;
		}

		const entry = this.lumps.GL_PVS;
		const rowSize = Math.ceil(this.glSubsectorCount / 8);
		const offset = entry.pos + from * rowSize + (to >> 3);
		return (this.wad.bytes[offset] & (1 << (to & 7))) !== 0;
	}

	glpvsVisibleFrom(from)
	{
		const sectors = new Set;


		if(!this.lumps.GL_PVS)
		{
			console.warn('No GL_PVS node found.');
			return sectors;
		}

		const visible = [];
		const entry = this.lumps.GL_PVS;
		const rowSize = Math.ceil(this.glSubsectorCount / 8);
		const rowStart = entry.pos + from * rowSize;

		for(let to = 0; to < this.glSubsectorCount; to++)
		{
			const byte = this.wad.bytes[rowStart + (to >> 3)];
			if(byte & (1 << (to & 7))) visible.push(to);
		}

		for(const index of visible)
		{
			const ssect = this.glSubsector(index);
			sectors.add(ssect.sector);
		}

		return sectors;
	}

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

	bspPoint(x, y, getSubsect = false)
	{
		if(!this.bsp.length)
		{
			console.warn('No BSP tree for map ' + this.name)
			return null;
		}

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
					if(getSubsect) return subsector;
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
					if(getSubsect) return subsector;
					const sector = this.sector(subsector.sector);
					return sector;
				}

				parent = this.bsp[ parent.right.child ];
			}
		}
	}

	splitMap(name)
	{
		const header = new Uint8Array(12);
		const hLong  = new Uint32Array(header.buffer);

		header.set(new TextEncoder().encode('PWAD'), 0);
		const hlen = 12;
		const directory = [];
		const lumps = [];

		let entries = [];
		let written = 0;
		for(const [name, entry] of Object.entries(this.lumps))
		{
			const entryBytes = new Uint8Array(16);
			const eLong  = new Uint32Array(entryBytes.buffer);
			eLong[0] = hlen + written;
			eLong[1] = entry.size;
			entryBytes.set(new TextEncoder().encode(entry.name), 8);
			directory.push(entryBytes);
			entries.push(entry.name);
			lumps.push(this.wad.lump(entry.index));
			written += entry.size;
		}

		hLong[1] = directory.length;
		hLong[2] = hlen + written;

		const getSize = (a,b) => a + b.length;
		const size = header.length + lumps.reduce(getSize, 0) + directory.reduce(getSize, 0);
		console.log({entries, size, header, directory, lumps});

		const result = new Uint8Array(size);

		written = 0;
		for(const chunk of [header, ...lumps, ...directory])
		{
			result.set(chunk, written);
			written += chunk.length;
		}

		return result;
	}
}

export class Wad
{
	constructor(byteArray, loader = null)
	{
		Object.defineProperty(this, 'bytes', {value: new Uint8Array(byteArray)});
		Object.defineProperty(this, 'view', {value: new DataView(this.bytes.buffer)});
		Object.defineProperty(this, 'loader', {value: loader});
		Object.defineProperty(this, 'cache', {value: {}});
		Object.defineProperty(this, 'entries', {value: {}});
		Object.defineProperty(this, 'lumps', {value: {}});
		Object.defineProperty(this, 'patches', {value: {}});
		Object.defineProperty(this, 'textures', {value: {}});
		Object.defineProperty(this, 'flats', {value: {}});
		Object.defineProperty(this, 'texAnim', {value: {}});
		Object.defineProperty(this, 'flatAnim', {value: {}});
		Object.defineProperty(this, 'pictures', {value: {}});
		Object.defineProperty(this, 'sprites', {value: {}});
		Object.defineProperty(this, 'samples', {value: {}});

		for(let i = 0; i < this.lumpCount; i++)
		{
			const entry = this.getDirEntry(i);
			const existing = this.entries[entry.name];
			if(existing && !MAP_LUMPS.includes(entry.name)) console.warn(`Lump index ${i} "${entry.name}" is double defined (${existing.index}).`);
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

	async hash()
	{
		const hash = new Uint8Array(await window.crypto.subtle.digest("SHA-256", this.bytes));
		return [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
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

	get lumpNames()
	{
		return Object.keys(this.entries);
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

		if(!entry)
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
		if(!this.cache.maps)
		{
			this.cache.maps = [];
		}
		else
		{
			return [...this.cache.maps];
		}

		const maps = this.cache.maps;

		for(let i = 0; i < this.lumpCount + -3; i++)
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

		return [...maps];
	}

	findNextMap(mapName)
	{
		const maps = this.findMaps();
		const current = maps.indexOf(mapName);

		if(current < 0)
		{
			console.warn(`Cant find next map, provided map ${mapName} not found.`);
			return false;
		}

		if(current === maps.length - 1)
		{
			console.warn(`Cant find next map, provided map ${mapName} is the last map.`);
			return false;
		}

		return maps[current + 1];
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

			if(entry.name.length > 6 && entry.name.match(/[A-Z]\d[A-Z]\d$/))
			{
				const spriteName = entry.name.slice(0, -4);
				const frameA = entry.name.substr(-4, 1).charCodeAt(0) + -65;
				const frameB = entry.name.substr(-2, 1).charCodeAt(0) + -65;
				const dirA = Number(entry.name.substr(-3, 1));
				const dirB = Number(entry.name.substr(-1, 1));

				if(!this.sprites[spriteName])
				{
					this.sprites[spriteName] = [];
				}

				if(!this.sprites[spriteName][frameA])
				{
					this.sprites[spriteName][frameA] = [];
				}

				if(!this.sprites[spriteName][frameB])
				{
					this.sprites[spriteName][frameB] = [];
				}

				this.sprites[spriteName][frameA][dirA] = {picture: new Picture(entry), flipped: false};
				this.sprites[spriteName][frameB][dirB] = {picture: new Picture(entry), flipped: true};
			}
			else if(entry.name.match(/[A-Z]\d$/))
			{
				const spriteName = entry.name.slice(0, -2);
				const frame = entry.name.substr(-2, 1).charCodeAt(0) + -65;
				const dir = Number(entry.name.substr(-1, 1));

				if(!this.sprites[spriteName])
				{
					this.sprites[spriteName] = [];
				}

				if(!this.sprites[spriteName][frame])
				{
					this.sprites[spriteName][frame] = [];
				}

				this.sprites[spriteName][frame][dir] = {picture: new Picture(entry), flipped : false};
			}
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

		return this.sprites[name];
	}

	picture(name)
	{
		if(!this.entries[name])
		{
			return;
		}

		return new Picture(this.entries[name])
	}

	sample(name)
	{
		name = String(name).toUpperCase();

		if(!this.cache.sample)
		{
			this.cache.sample = new Map;
		}

		if(this.cache.sample.has(name))
		{
			return this.cache.sample.get(name);
		}

		const entry = this.entries[name];

		if(!entry)
		{
			return;
		}

		const format  = this.view.getInt16(entry.pos + 0*SHORT, true);
		const rate    = this.view.getInt16(entry.pos + 1*SHORT, true);
		const length  = this.view.getInt16(entry.pos + 2*SHORT, true);
		const zero    = this.view.getInt16(entry.pos + 3*SHORT, true);
		const samples = this.bytes.slice(entry.pos + 4*SHORT, entry.pos + 4*SHORT + length);

		const sample =  {rate, length, samples, format, zero};

		this.cache.sample.set(name, sample);

		return sample;
	}
}

export class WadLoader
{
	constructor(...byteArray)
	{
		const wads = byteArray.map(rawBytes => new Wad(rawBytes, this));
		this.wads = [...wads].reverse();

		if(wads[0].type !== 'IWAD')
		{
			console.warn(`Type of first .WAD is ${wads[0].type}, expected IWAD.`);
		}

		Object.freeze(this);
	}

	addPWad(rawBytes)
	{
		this.wads.unshift(new Wad(rawBytes, this));
	}

	async hash()
	{
		return await Promise.all(this.wads.map(w => w.hash()));
	}

	get lumpNames()
	{
		return this.wads.map(wad => wad.lumpNames).flat();
	}

	getDirEntry(index)
	{
		for(const wad of this.wads)
		{
			const entry = wad.getDirEntry(index);
			if(entry) return entry;
		}
	}

	getEntryByName(name)
	{
		for(const wad of this.wads)
		{
			const entry = wad.getEntryByName(name);
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

	findNextMap(mapName)
	{
		const maps = this.findMaps();
		const current = maps.indexOf(mapName);

		if(current < 0)
		{
			console.warn(`Cant find next map, provided map ${mapName} not found.`);
			return false;
		}

		if(current === maps.length - 1)
		{
			console.warn(`Cant find next map, provided map ${mapName} is the last map.`);
			return false;
		}

		return maps[current + 1];
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

	sprite(name)
	{
		for(const wad of this.wads)
		{
			const sprite = wad.sprite(name);
			if(sprite) return sprite;
		}
	}

	picture(name)
	{
		for(const wad of this.wads)
		{
			const picture = wad.picture(name);
			if(picture) return picture;
		}
	}

	sample(name)
	{
		for(const wad of this.wads)
		{
			const sample = wad.sample(name);
			if(sample) return sample;
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

export const thingTable = {
	0xffff: {sprite: '----' ,'seq': '-' ,    modifier: '',    comment: '(nothing)',},
	0x0000: {sprite: '----' ,'seq': '-' ,    modifier: '',    comment: '(nothing)',},
	0x0001: {sprite: 'PLAY', 'seq': '+' ,    modifier: '',    comment: 'Player 1 start (Player 1 start needed on ALL levels)',},
	0x0002: {sprite: 'PLAY', 'seq': '+' ,    modifier: '',    comment: 'Player 2 start (Player starts 2-4 are needed in)',},
	0x0003: {sprite: 'PLAY', 'seq': '+' ,    modifier: '',    comment: 'Player 3 start (cooperative mode multiplayer games)',},
	0x0004: {sprite: 'PLAY', 'seq': '+' ,    modifier: '',    comment: 'Player 4 start',},
	0x000b: {sprite: '----' ,'seq': '-' ,    modifier: '',    comment: 'Deathmatch start positions. Should have >= 4/level',},
	0x000e: {sprite: '----' ,'seq': '-' ,    modifier: '',    comment: 'Teleport landing. Where players/monsters land when they teleport to the SECTOR containing this thing',},
	0x0bbc: {sprite: 'POSS', 'seq': '+' ,    modifier: ' # ', comment: 'FORMER HUMAN: regular pistol-shooting zombieman',},
	0x0054: {sprite: 'SSWV', 'seq': '+' ,    modifier: ' # ', comment: 'WOLFENSTEIN SS: guest appearance by Wolf3D blue guy',},
	0x0009: {sprite: 'SPOS', 'seq': '+' ,    modifier: ' # ', comment: 'FORMER HUMAN SERGEANT: black armor, shotgunners',},
	0x0041: {sprite: 'CPOS', 'seq': '+' ,    modifier: ' # ', comment: 'HEAVY WEAPON DUDE: red armor, chaingunners',},
	0x0bb9: {sprite: 'TROO', 'seq': '+' ,    modifier: ' # ', comment: 'IMP: brown, hurl fireballs',},
	0x0bba: {sprite: 'SARG', 'seq': '+' ,    modifier: ' # ', comment: 'DEMON: pink, muscular bull-like chewers',},
	0x003a: {sprite: 'SARG', 'seq': '+' ,    modifier: ' # ', comment: 'SPECTRE: invisible version of the DEMON',},
	0x0bbe: {sprite: 'SKUL', 'seq': '+' ,    modifier: '^# ', comment: 'LOST SOUL: flying flaming skulls, they really bite',},
	0x0bbd: {sprite: 'HEAD', 'seq': '+' ,    modifier: '^# ', comment: 'CACODEMON: red one-eyed floating heads. Behold...',},
	0x0045: {sprite: 'BOS2', 'seq': '+' ,    modifier: ' # ', comment: 'HELL KNIGHT: grey-not-pink BARON, weaker',},
	0x0bbb: {sprite: 'BOSS', 'seq': '+' ,    modifier: ' # ', comment: 'BARON OF HELL: cloven hooved minotaur boss',},
	0x0044: {sprite: 'BSPI', 'seq': '+' ,    modifier: ' # ', comment: 'ARACHNOTRON: baby SPIDER, shoots green plasma',},
	0x0047: {sprite: 'PAIN', 'seq': '+' ,    modifier: '^# ', comment: 'PAIN ELEMENTAL: shoots LOST SOULS, deserves its name',},
	0x0042: {sprite: 'SKEL', 'seq': '+' ,    modifier: ' # ', comment: 'REVENANT: Fast skeletal dude shoots homing missles',},
	0x0043: {sprite: 'FATT', 'seq': '+' ,    modifier: ' # ', comment: 'MANCUBUS: Big, slow brown guy shoots barrage of fire',},
	0x0040: {sprite: 'VILE', 'seq': '+' ,    modifier: ' # ', comment: 'ARCH-VILE: Super-fire attack, ressurects the dead!',},
	0x0007: {sprite: 'SPID', 'seq': '+' ,    modifier: ' # ', comment: 'SPIDER MASTERMIND: giant walking brain boss',},
	0x0010: {sprite: 'CYBR', 'seq': '+' ,    modifier: ' # ', comment: 'CYBER-DEMON: robo-boss, rocket launcher',},
	0x0058: {sprite: 'BBRN', 'seq': '+' ,    modifier: ' # ', comment: 'BOSS BRAIN: Horrifying visage of the ultimate demon',},
	0x0059: {sprite: '-' ,   'seq': '-' ,    modifier: '',    comment: 'Boss Shooter: Shoots spinning skull-blocks',},
	0x0057: {sprite: '-' ,   'seq': '-' ,    modifier: '',    comment: 'Spawn Spot: Where Todd McFarlane\'s guys appear',},
	0x07d5: {sprite: 'CSAW', 'seq': 'a',     modifier: ' $ ', comment: 'Chainsaw',},
	0x07d1: {sprite: 'SHOT', 'seq': 'a',     modifier: ' $ ', comment: 'Shotgun',},
	0x0052: {sprite: 'SGN2', 'seq': 'a',     modifier: ' $ ', comment: 'Double-barreled shotgun',},
	0x07d2: {sprite: 'MGUN', 'seq': 'a',     modifier: ' $ ', comment: 'Chaingun, gatling gun, mini-gun, whatever',},
	0x07d3: {sprite: 'LAUN', 'seq': 'a',     modifier: ' $ ', comment: 'Rocket launcher',},
	0x07d4: {sprite: 'PLAS', 'seq': 'a',     modifier: ' $ ', comment: 'Plasma gun',},
	0x07d6: {sprite: 'BFUG', 'seq': 'a',     modifier: ' $ ', comment: 'Bfg9000',},
	0x07d7: {sprite: 'CLIP', 'seq': 'a',     modifier: ' $ ', comment: 'Ammo clip',},
	0x07d8: {sprite: 'SHEL', 'seq': 'a',     modifier: ' $ ', comment: 'Shotgun shells',},
	0x07da: {sprite: 'ROCK', 'seq': 'a',     modifier: ' $ ', comment: 'A rocket',},
	0x07ff: {sprite: 'CELL', 'seq': 'a',     modifier: ' $ ', comment: 'Cell charge',},
	0x0800: {sprite: 'AMMO', 'seq': 'a',     modifier: ' $ ', comment: 'Box of Ammo',},
	0x0801: {sprite: 'SBOX', 'seq': 'a',     modifier: ' $ ', comment: 'Box of Shells',},
	0x07fe: {sprite: 'BROK', 'seq': 'a',     modifier: ' $ ', comment: 'Box of Rockets',},
	0x0011: {sprite: 'CELP', 'seq': 'a',     modifier: ' $ ', comment: 'Cell charge pack',},
	0x0008: {sprite: 'BPAK', 'seq': 'a',     modifier: ' $ ', comment: 'Backpack: doubles maximum ammo capacities',},
	0x07db: {sprite: 'STIM', 'seq': 'a',     modifier: ' $ ', comment: 'Stimpak',},
	0x07dc: {sprite: 'MEDI', 'seq': 'a',     modifier: ' $ ', comment: 'Medikit',},
	0x07de: {sprite: 'BON1', 'seq': 'abcdcb',modifier: ' ! ', comment: 'Health Potion +1% health',},
	0x07df: {sprite: 'BON2', 'seq': 'abcdcb',modifier: ' ! ', comment: 'Spirit Armor +1% armor',},
	0x07e2: {sprite: 'ARM1', 'seq': 'ab',    modifier: ' $ ', comment: 'Green armor 100%',},
	0x07e3: {sprite: 'ARM2', 'seq': 'ab',    modifier: ' $ ', comment: 'Blue armor 200%',},
	0x0053: {sprite: 'MEGA', 'seq': 'abcd',  modifier: ' ! ', comment: 'Megasphere: 200% health, 200% armor',},
	0x07dd: {sprite: 'SOUL', 'seq': 'abcdcb',modifier: ' ! ', comment: 'Soulsphere, Supercharge, +100% health',},
	0x07e6: {sprite: 'PINV', 'seq': 'abcd',  modifier: ' ! ', comment: 'Invulnerability',},
	0x07e7: {sprite: 'PSTR', 'seq': 'a',     modifier: ' ! ', comment: 'Berserk Strength and 100% health',},
	0x07e8: {sprite: 'PINS', 'seq': 'abcd',  modifier: ' ! ', comment: 'Invisibility',},
	0x07e9: {sprite: 'SUIT', 'seq': 'a',     modifier: '(!)', comment: 'Radiation suit - see notes on ! above',},
	0x07ea: {sprite: 'PMAP', 'seq': 'abcdcb',modifier: ' ! ', comment: 'Computer map',},
	0x07fd: {sprite: 'PVIS', 'seq': 'ab',    modifier: ' ! ', comment: 'Lite Amplification goggles',},
	0x0005: {sprite: 'BKEY', 'seq': 'ab',    modifier: ' $ ', comment: 'Blue keycard',},
	0x0028: {sprite: 'BSKU', 'seq': 'ab',    modifier: ' $ ', comment: 'Blue skullkey',},
	0x000d: {sprite: 'RKEY', 'seq': 'ab',    modifier: ' $ ', comment: 'Red keycard',},
	0x0026: {sprite: 'RSKU', 'seq': 'ab',    modifier: ' $ ', comment: 'Red skullkey',},
	0x0006: {sprite: 'YKEY', 'seq': 'ab',    modifier: ' $ ', comment: 'Yellow keycard',},
	0x0027: {sprite: 'YSKU', 'seq': 'ab',    modifier: ' $ ', comment: 'Yellow skullkey',},
	0x07f3: {sprite: 'BAR1', 'seq': 'ab+',   modifier: ' # ', comment: 'Barrel; not an obstacle after blown up (BEXP sprite)',},
	0x0048: {sprite: 'KEEN', 'seq': 'a+',    modifier: ' # ', comment: 'A guest appearance by Billy',},
	0x0030: {sprite: 'ELEC', 'seq': 'a',     modifier: ' # ', comment: 'Tall, techno pillar',},
	0x001e: {sprite: 'COL1', 'seq': 'a',     modifier: ' # ', comment: 'Tall green pillar',},
	0x0020: {sprite: 'COL3', 'seq': 'a',     modifier: ' # ', comment: 'Tall red pillar',},
	0x001f: {sprite: 'COL2', 'seq': 'a',     modifier: ' # ', comment: 'Short green pillar',},
	0x0024: {sprite: 'COL5', 'seq': 'ab',    modifier: ' # ', comment: 'Short green pillar with beating heart',},
	0x0021: {sprite: 'COL4', 'seq': 'a',     modifier: ' # ', comment: 'Short red pillar',},
	0x0025: {sprite: 'COL6', 'seq': 'a',     modifier: ' # ', comment: 'Short red pillar with skull',},
	0x002f: {sprite: 'SMIT', 'seq': 'a',     modifier: ' # ', comment: 'Stalagmite: small brown pointy stump',},
	0x002b: {sprite: 'TRE1', 'seq': 'a',     modifier: ' # ', comment: 'Burnt tree: gray tree',},
	0x0036: {sprite: 'TRE2', 'seq': 'a',     modifier: ' # ', comment: 'Large brown tree',},
	0x07ec: {sprite: 'COLU', 'seq': 'a',     modifier: ' # ', comment: 'Floor lamp',},
	0x0055: {sprite: 'TLMP', 'seq': 'abcd',  modifier: ' # ', comment: 'Tall techno floor lamp',},
	0x0056: {sprite: 'TLP2', 'seq': 'abcd',  modifier: ' # ', comment: 'Short techno floor lamp',},
	0x0022: {sprite: 'CAND', 'seq': 'a',     modifier: '',    comment: 'Candle',},
	0x0023: {sprite: 'CBRA', 'seq': 'a',     modifier: ' # ', comment: 'Candelabra',},
	0x002c: {sprite: 'TBLU', 'seq': 'abcd',  modifier: ' # ', comment: 'Tall blue firestick',},
	0x002d: {sprite: 'TGRE', 'seq': 'abcd',  modifier: ' # ', comment: 'Tall green firestick',},
	0x002e: {sprite: 'TRED', 'seq': 'abcd',  modifier: ' # ', comment: 'Tall red firestick',},
	0x0037: {sprite: 'SMBT', 'seq': 'abcd',  modifier: ' # ', comment: 'Short blue firestick',},
	0x0038: {sprite: 'SMGT', 'seq': 'abcd',  modifier: ' # ', comment: 'Short green firestick',},
	0x0039: {sprite: 'SMRT', 'seq': 'abcd',  modifier: ' # ', comment: 'Short red firestick',},
	0x0046: {sprite: 'FCAN', 'seq': 'abc',   modifier: ' # ', comment: 'Burning barrel',},
	0x0029: {sprite: 'CEYE', 'seq': 'abcb',  modifier: ' # ', comment: 'Evil Eye: floating eye in symbol, over candle',},
	0x002a: {sprite: 'FSKU', 'seq': 'abc',   modifier: ' # ', comment: 'Floating Skull: flaming skull-rock',},
	0x0031: {sprite: 'GOR1', 'seq': 'abcb',  modifier: '^# ', comment: 'Hanging victim, twitching',},
	0x003f: {sprite: 'GOR1', 'seq': 'abcb',  modifier: '^  ', comment: 'Hanging victim, twitching',},
	0x0032: {sprite: 'GOR2', 'seq': 'a',     modifier: '^# ', comment: 'Hanging victim, arms out',},
	0x003b: {sprite: 'GOR2', 'seq': 'a',     modifier: '^  ', comment: 'Hanging victim, arms out',},
	0x0034: {sprite: 'GOR4', 'seq': 'a',     modifier: '^# ', comment: 'Hanging pair of legs',},
	0x003c: {sprite: 'GOR4', 'seq': 'a',     modifier: '^  ', comment: 'Hanging pair of legs',},
	0x0033: {sprite: 'GOR3', 'seq': 'a',     modifier: '^# ', comment: 'Hanging victim, 1-legged',},
	0x003d: {sprite: 'GOR3', 'seq': 'a',     modifier: '^  ', comment: 'Hanging victim, 1-legged',},
	0x0035: {sprite: 'GOR5', 'seq': 'a',     modifier: '^# ', comment: 'Hanging leg',},
	0x003e: {sprite: 'GOR5', 'seq': 'a',     modifier: '^  ', comment: 'Hanging leg',},
	0x0049: {sprite: 'HDB1', 'seq': 'a',     modifier: '^# ', comment: 'Hanging victim, guts removed',},
	0x004a: {sprite: 'HDB2', 'seq': 'a',     modifier: '^# ', comment: 'Hanging victim, guts and brain removed',},
	0x004b: {sprite: 'HDB3', 'seq': 'a',     modifier: '^# ', comment: 'Hanging torso, looking down',},
	0x004c: {sprite: 'HDB4', 'seq': 'a',     modifier: '^# ', comment: 'Hanging torso, open skull',},
	0x004d: {sprite: 'HDB5', 'seq': 'a',     modifier: '^# ', comment: 'Hanging torso, looking up',},
	0x004e: {sprite: 'HDB6', 'seq': 'a',     modifier: '^# ', comment: 'Hanging torso, brain removed',},
	0x0019: {sprite: 'POL1', 'seq': 'a',     modifier: ' # ', comment: 'Impaled human',},
	0x001a: {sprite: 'POL6', 'seq': 'ab',    modifier: ' # ', comment: 'Twitching impaled human',},
	0x001b: {sprite: 'POL4', 'seq': 'a',     modifier: ' # ', comment: 'Skull on a pole',},
	0x001c: {sprite: 'POL2', 'seq': 'a',     modifier: ' # ', comment: '5 skulls shish kebob',},
	0x001d: {sprite: 'POL3', 'seq': 'ab',    modifier: ' # ', comment: 'Pile of skulls and candles',},
	0x000a: {sprite: 'PLAY', 'seq': 'w',     modifier: '',    comment: 'Bloody mess (an exploded player)',},
	0x000c: {sprite: 'PLAY', 'seq': 'w',     modifier: '',    comment: 'Bloody mess, this thing is exactly the same as 10',},
	0x0018: {sprite: 'POL5', 'seq': 'a',     modifier: '',    comment: 'Pool of blood and flesh',},
	0x004f: {sprite: 'POB1', 'seq': 'a',     modifier: '',    comment: 'Pool of blood',},
	0x0050: {sprite: 'POB2', 'seq': 'a',     modifier: '',    comment: 'Pool of blood',},
	0x0051: {sprite: 'BRS1', 'seq': 'a',     modifier: '',    comment: 'Pool of brains',},
	0x000f: {sprite: 'PLAY', 'seq': 'n',     modifier: '',    comment: 'Dead player',},
	0x0012: {sprite: 'POSS', 'seq': 'l',     modifier: '',    comment: 'Dead former human',},
	0x0013: {sprite: 'SPOS', 'seq': 'l',     modifier: '',    comment: 'Dead former sergeant',},
	0x0014: {sprite: 'TROO', 'seq': 'm',     modifier: '',    comment: 'Dead imp',},
	0x0015: {sprite: 'SARG', 'seq': 'n',     modifier: '',    comment: 'Dead demon',},
	0x0016: {sprite: 'HEAD', 'seq': 'l',     modifier: '',    comment: 'Dead cacodemon',},
	0x0017: {sprite: 'SKUL', 'seq': 'k',     modifier: '',    comment: 'Dead lost soul, invisible (they blow up when killed)',},
};

export const actionTable = {
	// Local Doors
	1:   {type: 'mDoor',  modifier: 'nSRm', sound: 'DOOR',   speed: 'med',     tm:   4,   chg: '-',   effect: 'open/close'},
	26:  {type: 'mDoor',  modifier: 'nSR',  sound: 'DOOR',   speed: 'med',     tm:   4,   chg: '-',   effect: 'open/close BLUE KEY'},
	28:  {type: 'mDoor',  modifier: 'nSR',  sound: 'DOOR',   speed: 'med',     tm:   4,   chg: '-',   effect: 'open/close RED KEY'},
	27:  {type: 'mDoor',  modifier: 'nSR',  sound: 'DOOR',   speed: 'med',     tm:   4,   chg: '-',   effect: 'open/close YELLOW KEY'},
	31:  {type: 'mDoor',  modifier: 'nS1',  sound: 'DOOR',   speed: 'med',     tm:  -1,   chg: '-',   effect: 'open'},
	32:  {type: 'mDoor',  modifier: 'nS1',  sound: 'DOOR',   speed: 'med',     tm:  -1,   chg: '-',   effect: 'open BLUE KEY'},
	33:  {type: 'mDoor',  modifier: 'nS1',  sound: 'DOOR',   speed: 'med',     tm:  -1,   chg: '-',   effect: 'open RED KEY'},
	34:  {type: 'mDoor',  modifier: 'nS1',  sound: 'DOOR',   speed: 'med',     tm:  -1,   chg: '-',   effect: 'open YELLOW KEY'},
	46:  {type: 'mDoor',  modifier: 'nGR',  sound: 'DOOR',   speed: 'med',     tm:  -1,   chg: '-',   effect: 'open'},
	117: {type: 'mDoor',  modifier: 'nSR',  sound: 'BLAZE',  speed: 'turbo',   tm:   4,   chg: '-',   effect: 'open/close'},

	// Remote Doors
	4:   {type: 'rDoor',  modifier: 'W1',   sound: 'DOOR',   speed: 'med',     tm:   4,   chg: '-',   effect: 'open,close'},
	29:  {type: 'rDoor',  modifier: 'S1',   sound: 'DOOR',   speed: 'med',     tm:   4,   chg: '-',   effect: 'open,close'},
	90:  {type: 'rDoor',  modifier: 'WR',   sound: 'DOOR',   speed: 'med',     tm:   4,   chg: '-',   effect: 'open,close'},
	63:  {type: 'rDoor',  modifier: 'SR',   sound: 'DOOR',   speed: 'med',     tm:   4,   chg: '-',   effect: 'open,close'},
	2:   {type: 'rDoor',  modifier: 'W1',   sound: 'DOOR',   speed: 'med',     tm:  -1,   chg: '-',   effect: 'open'},
	103: {type: 'rDoor',  modifier: 'S1',   sound: 'DOOR',   speed: 'med',     tm:  -1,   chg: '-',   effect: 'open'},
	86:  {type: 'rDoor',  modifier: 'WR',   sound: 'DOOR',   speed: 'med',     tm:  -1,   chg: '-',   effect: 'open'},
	61:  {type: 'rDoor',  modifier: 'SR',   sound: 'DOOR',   speed: 'med',     tm:  -1,   chg: '-',   effect: 'open'},
	3:   {type: 'rDoor',  modifier: 'W1',   sound: 'DOOR',   speed: 'med',     tm:  -1,   chg: '-',   effect: 'close'},
	50:  {type: 'rDoor',  modifier: 'S1',   sound: 'DOOR',   speed: 'med',     tm:  -1,   chg: '-',   effect: 'close'},
	75:  {type: 'rDoor',  modifier: 'WR',   sound: 'DOOR',   speed: 'med',     tm:  -1,   chg: '-',   effect: 'close'},
	42:  {type: 'rDoor',  modifier: 'SR',   sound: 'DOOR',   speed: 'med',     tm:  -1,   chg: '-',   effect: 'close'},
	16:  {type: 'rDoor',  modifier: 'W1',   sound: 'DOOR',   speed: 'med',     tm:  30,   chg: '-',   effect: 'close, then opens'},
	76:  {type: 'rDoor',  modifier: 'WR',   sound: 'DOOR',   speed: 'med',     tm:  30,   chg: '-',   effect: 'close, then opens'},
	108: {type: 'rDoor',  modifier: 'W1',   sound: 'BLAZE',  speed: 'turbo',   tm:   4,   chg: '-',   effect: 'open,close'},
	111: {type: 'rDoor',  modifier: 'WR',   sound: 'BLAZE',  speed: 'turbo',   tm:   4,   chg: '-',   effect: 'open,close'},
	105: {type: 'rDoor',  modifier: 'S1',   sound: 'BLAZE',  speed: 'turbo',   tm:   4,   chg: '-',   effect: 'open,close'},
	114: {type: 'rDoor',  modifier: 'SR',   sound: 'BLAZE',  speed: 'turbo',   tm:   4,   chg: '-',   effect: 'open,close'},
	109: {type: 'rDoor',  modifier: 'W1',   sound: 'BLAZE',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'open'},
	112: {type: 'rDoor',  modifier: 'S1',   sound: 'BLAZE',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'open'},
	106: {type: 'rDoor',  modifier: 'WR',   sound: 'BLAZE',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'open'},
	115: {type: 'rDoor',  modifier: 'SR',   sound: 'BLAZE',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'open'},
	110: {type: 'rDoor',  modifier: 'W1',   sound: 'BLAZE',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'close'},
	113: {type: 'rDoor',  modifier: 'S1',   sound: 'BLAZE',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'close'},
	107: {type: 'rDoor',  modifier: 'WR',   sound: 'BLAZE',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'close'},
	116: {type: 'rDoor',  modifier: 'SR',   sound: 'BLAZE',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'close'},
	133: {type: 'rDoor',  modifier: 'S1',   sound: 'BLAZE',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'open BLUE KEY'},
	99:  {type: 'rDoor',  modifier: 'SR',   sound: 'BLAZE',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'open BLUE KEY'},
	135: {type: 'rDoor',  modifier: 'S1',   sound: 'BLAZE',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'open RED KEY'},
	134: {type: 'rDoor',  modifier: 'SR',   sound: 'BLAZE',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'open RED KEY'},
	137: {type: 'rDoor',  modifier: 'S1',   sound: 'BLAZE',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'open YELLOW KEY'},
	136: {type: 'rDoor',  modifier: 'SR',   sound: 'BLAZE',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'open YELLOW KEY'},

	// Ceilings
	40:  {type: 'Ceil',   modifier: 'W1',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up to HEC'},
	41:  {type: 'Ceil',   modifier: 'S1',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'down to floor'},
	43:  {type: 'Ceil',   modifier: 'SR',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'down to floor'},
	44:  {type: 'Ceil',   modifier: 'W1',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'down to floor + 8'},
	49:  {type: 'Ceil',   modifier: 'S1',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'down to floor + 8'},
	72:  {type: 'Ceil',   modifier: 'WR',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'down to floor + 8'},

	// Lifts
	10:  {type: 'Lift',   modifier: 'W1',    sound: 'LIFT',   speed: 'fast',    tm:   3,   chg: '-',   effect: 'lift'},
	21:  {type: 'Lift',   modifier: 'S1',    sound: 'LIFT',   speed: 'fast',    tm:   3,   chg: '-',   effect: 'lift'},
	88:  {type: 'Lift',   modifier: 'WRm',   sound: 'LIFT',   speed: 'fast',    tm:   3,   chg: '-',   effect: 'lift'},
	62:  {type: 'Lift',   modifier: 'SR',    sound: 'LIFT',   speed: 'fast',    tm:   3,   chg: '-',   effect: 'lift'},
	121: {type: 'Lift',   modifier: 'W1',    sound: 'LIFT',   speed: 'turbo',   tm:   3,   chg: '-',   effect: 'lift'},
	122: {type: 'Lift',   modifier: 'S1',    sound: 'LIFT',   speed: 'turbo',   tm:   3,   chg: '-',   effect: 'lift'},
	120: {type: 'Lift',   modifier: 'WR',    sound: 'LIFT',   speed: 'turbo',   tm:   3,   chg: '-',   effect: 'lift'},
	123: {type: 'Lift',   modifier: 'SR',    sound: 'LIFT',   speed: 'turbo',   tm:   3,   chg: '-',   effect: 'lift'},

	// Floors
	119: {type: 'Floor',  modifier: 'W1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up to nhEF'},
	128: {type: 'Floor',  modifier: 'WR',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up to nhEF'},
	18:  {type: 'Floor',  modifier: 'S1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up to nhEF'},
	69:  {type: 'Floor',  modifier: 'SR',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up to nhEF'},
	22:  {type: 'Floor',  modifier: 'W1&',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: 'TX',  effect: 'up to nhEF'},
	95:  {type: 'Floor',  modifier: 'WR&',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: 'TX',  effect: 'up to nhEF'},
	20:  {type: 'Floor',  modifier: 'S1&',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: 'TX',  effect: 'up to nhEF'},
	68:  {type: 'Floor',  modifier: 'SR&',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: 'TX',  effect: 'up to nhEF'},
	47:  {type: 'Floor',  modifier: 'G1&',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: 'TX',  effect: 'up to nhEF'},
	5:   {type: 'Floor',  modifier: 'W1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up to LIC'},
	91:  {type: 'Floor',  modifier: 'WR',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up to LIC'},
	101: {type: 'Floor',  modifier: 'S1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up to LIC'},
	64:  {type: 'Floor',  modifier: 'SR',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up to LIC'},
	24:  {type: 'Floor',  modifier: 'G1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up to LIC'},
	130: {type: 'Floor',  modifier: 'W1',    sound: 'MOVER',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'up to nhEF'},
	131: {type: 'Floor',  modifier: 'S1',    sound: 'MOVER',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'up to nhEF'},
	129: {type: 'Floor',  modifier: 'WR',    sound: 'MOVER',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'up to nhEF'},
	132: {type: 'Floor',  modifier: 'SR',    sound: 'MOVER',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'up to nhEF'},
	56:  {type: 'Floor',  modifier: 'W1&',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up to LIC - 8, CRUSH'},
	94:  {type: 'Floor',  modifier: 'WR&',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up to LIC - 8, CRUSH'},
	55:  {type: 'Floor',  modifier: 'S1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up to LIC - 8, CRUSH'},
	65:  {type: 'Floor',  modifier: 'SR',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up to LIC - 8, CRUSH'},
	58:  {type: 'Floor',  modifier: 'W1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up 24'},
	92:  {type: 'Floor',  modifier: 'WR',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up 24'},
	15:  {type: 'Floor',  modifier: 'S1&',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: 'TX',  effect: 'up 24'},
	66:  {type: 'Floor',  modifier: 'SR&',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: 'TX',  effect: 'up 24'},
	59:  {type: 'Floor',  modifier: 'W1&',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: 'TXP', effect: 'up 24'},
	93:  {type: 'Floor',  modifier: 'WR&',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: 'TXP', effect: 'up 24'},
	14:  {type: 'Floor',  modifier: 'S1&',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: 'TX',  effect: 'up 32'},
	67:  {type: 'Floor',  modifier: 'SR&',   sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: 'TX',  effect: 'up 32'},
	140: {type: 'Floor',  modifier: 'S1',    sound: 'MOVER',  speed: 'med',     tm:  -1,   chg: '-',   effect: 'up 512'},
	30:  {type: 'Floor',  modifier: 'W1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up ShortestLowerTexture'},
	96:  {type: 'Floor',  modifier: 'WR',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'up ShortestLowerTexture'},
	38:  {type: 'Floor',  modifier: 'W1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'down to LEF'},
	23:  {type: 'Floor',  modifier: 'S1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'down to LEF'},
	82:  {type: 'Floor',  modifier: 'WR',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'down to LEF'},
	60:  {type: 'Floor',  modifier: 'SR',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'down to LEF'},
	37:  {type: 'Floor',  modifier: 'W1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: 'NXP', effect: 'down to LEF'},
	84:  {type: 'Floor',  modifier: 'WR',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: 'NXP', effect: 'down to LEF'},
	19:  {type: 'Floor',  modifier: 'W1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'down to HEF'},
	102: {type: 'Floor',  modifier: 'S1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'down to HEF'},
	83:  {type: 'Floor',  modifier: 'WR',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'down to HEF'},
	45:  {type: 'Floor',  modifier: 'SR',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'down to HEF'},
	36:  {type: 'Floor',  modifier: 'W1',    sound: 'MOVER',  speed: 'fast',    tm:  -1,   chg: '-',   effect: 'down to HEF + 8'},
	71:  {type: 'Floor',  modifier: 'S1',    sound: 'MOVER',  speed: 'fast',    tm:  -1,   chg: '-',   effect: 'down to HEF + 8'},
	98:  {type: 'Floor',  modifier: 'WR',    sound: 'MOVER',  speed: 'fast',    tm:  -1,   chg: '-',   effect: 'down to HEF + 8'},
	70:  {type: 'Floor',  modifier: 'SR',    sound: 'MOVER',  speed: 'fast',    tm:  -1,   chg: '-',   effect: 'down to HEF + 8'},
	9:   {type: 'Floor',  modifier: 'S1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: 'NXP', effect: 'donut (see note 12 above)'},

	// Stairs
	8:   {type: 'Stair',  modifier: 'W1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'stairs'},
	7:   {type: 'Stair',  modifier: 'S1',    sound: 'MOVER',  speed: 'slow',    tm:  -1,   chg: '-',   effect: 'stairs'},
	100: {type: 'Stair',  modifier: 'W1',    sound: 'MOVER',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'stairs (each up 16 not 8) + crush'},
	127: {type: 'Stair',  modifier: 'S1',    sound: 'MOVER',  speed: 'turbo',   tm:  -1,   chg: '-',   effect: 'stairs (each up 16 not 8) + crush'},

	// Moving Floors
	53:  {type: 'MvFlr',  modifier: 'W1&',   sound: 'LIFT',   speed: 'slow',    tm:   3,   chg: '-',   effect: 'start moving floor'},
	54:  {type: 'MvFlr',  modifier: 'W1&',   sound: '-' ,     speed: '-',       tm:  -1,   chg: '-',   effect: 'stop moving floor'},
	87:  {type: 'MvFlr',  modifier: 'WR&',   sound: 'LIFT',   speed: 'slow',    tm:   3,   chg: '-',   effect: 'start moving floor'},
	89:  {type: 'MvFlr',  modifier: 'WR&',   sound: '-' ,     speed: '-',       tm:  -1,   chg: '-',   effect: 'stop moving floor'},

	// Crushing Ceilings
	6:   {type: 'Crush',  modifier: 'W1&',   sound: 'CRUSH',  speed: 'med',     tm:   0,   chg: '-',   effect: 'start crushing, fast hurt'},
	25:  {type: 'Crush',  modifier: 'W1&',   sound: 'CRUSH',  speed: 'med',     tm:   0,   chg: '-',   effect: 'start crushing, slow hurt'},
	73:  {type: 'Crush',  modifier: 'WR&',   sound: 'CRUSH',  speed: 'slow',    tm:   0,   chg: '-',   effect: 'start crushing, slow hurt'},
	77:  {type: 'Crush',  modifier: 'WR&',   sound: 'CRUSH',  speed: 'med',     tm:   0,   chg: '-',   effect: 'start crushing, fast hurt'},
	57:  {type: 'Crush',  modifier: 'W1&',   sound: '-',      speed: '-',       tm:  -1,   chg: '-',   effect: 'stop crush'},
	74:  {type: 'Crush',  modifier: 'WR&',   sound: '-',      speed: '-',       tm:  -1,   chg: '-',   effect: 'stop crush'},
	141: {type: 'Crush',  modifier: 'W1&',   sound: 'none?',  speed: 'slow',    tm:   0,   chg: '-',   effect: 'start crushing, slow hurt "Silent"'},

	// Exit Level
	11:  {type: 'Exit',   modifier: 'nS-',   sound: 'CLUNK',  speed: '-',       tm:  -1,   chg: '-',   effect: 'End level, go to next level'},
	51:  {type: 'Exit',   modifier: 'nS-',   sound: 'CLUNK',  speed: '-',       tm:  -1,   chg: '-',   effect: 'End level, go to secret level'},
	52:  {type: 'Exit',   modifier: 'nW-',   sound: 'CLUNK',  speed: '-',       tm:  -1,   chg: '-',   effect: 'End level, go to next level'},
	124: {type: 'Exit',   modifier: 'nW-',   sound: 'CLUNK',  speed: '-',       tm:  -1,   chg: '-',   effect: 'End level, go to secret level'},

	// Teleport
	39:  {type: 'Telpt',  modifier: 'W1m',   sound: 'TPORT',  speed: '-',       tm:  -1,   chg: '-',   effect: 'Teleport'},
	97:  {type: 'Telpt',  modifier: 'WRm',   sound: 'TPORT',  speed: '-',       tm:  -1,   chg: '-',   effect: 'Teleport'},
	125: {type: 'Telpt',  modifier: 'W1m',   sound: 'TPORT',  speed: '-',       tm:  -1,   chg: '-',   effect: 'Teleport monsters only'},
	126: {type: 'Telpt',  modifier: 'WRm',   sound: 'TPORT',  speed: '-',       tm:  -1,   chg: '-',   effect: 'Teleport monsters only'},

	// Light
	35:   {type: 'Light', modifier: 'W1',   sound: '-',      speed: '-',       tm:  -1,   chg: '-',   effect: '0'},
	104:  {type: 'Light', modifier: 'W1',   sound: '-',      speed: '-',       tm:  -1,   chg: '-',   effect: 'LE (light level)'},
	12:   {type: 'Light', modifier: 'W1',   sound: '-',      speed: '-',       tm:  -1,   chg: '-',   effect: 'HE (light level)'},
	13:   {type: 'Light', modifier: 'W1',   sound: '-',      speed: '-',       tm:  -1,   chg: '-',   effect: '255'},
	79:   {type: 'Light', modifier: 'WR',   sound: '-',      speed: '-',       tm:  -1,   chg: '-',   effect: '0'},
	80:   {type: 'Light', modifier: 'WR',   sound: '-',      speed: '-',       tm:  -1,   chg: '-',   effect: 'HE (light level)'},
	81:   {type: 'Light', modifier: 'WR',   sound: '-',      speed: '-',       tm:  -1,   chg: '-',   effect: '255'},
	17:   {type: 'Light', modifier: 'W1',   sound: '-',      speed: '-',       tm:  -1,   chg: '-',   effect: 'Light blinks (see [4-9-1] type 3)'},
	138:  {type: 'Light', modifier: 'SR',   sound: 'CLUNK',  speed: '-',       tm:  -1,   chg: '-',   effect: '255'},
	139:  {type: 'Light', modifier: 'SR',   sound: 'CLUNK',  speed: '-',       tm:  -1,   chg: '-',   effect: '0'},
};

export const actionTableHexen = {
	11:  {type: 'mDoor',  modifier: 'WR',  sound: 'DOOR',   speed: 'med',     tm:   4,   chg: '-',   effect: 'open/close'},
	12:  {type: 'mDoor',  modifier: 'SR',  sound: 'DOOR',   speed: 'med',     tm:   4,   chg: '-',   effect: 'open/close'},
};

export const soundMapping = {
	DOOR:  {start: 'DOROPN', stop: null,    move: null,     startReturn: 'DORCLS', stopReturn: null},
	BLAZE: {start: null,     stop: null,    move: null,     startReturn: null,     stopReturn: null},
	MOVER: {start: null,     stop: 'PSTOP', move: 'STNMOV', startReturn: null,     stopReturn: null},
	LIFT:  {start: 'PSTART', stop: 'PSTOP', move: null,     startReturn: null,     stopReturn: null},
	CRUSH: {start: null,     stop: null,    move: null,     startReturn: null,     stopReturn: null},
	CLUNK: {start: null,     stop: null,    move: null,     startReturn: null,     stopReturn: null},
	TPORT: {start: null,     stop: null,    move: null,     startReturn: null,     stopReturn: null},
}

export const specialTable = {
	0x00: {type: '-',      effect: 'Normal, no special characteristic.'},
	0x01: {type: 'Light',  effect: 'random off'},
	0x02: {type: 'Light',  effect: 'blink 0.5 second'},
	0x03: {type: 'Light',  effect: 'blink 1.0 second'},
	0x04: {type: 'Both',   effect: '-10/20% health AND light blink 0.5 second'},
	0x05: {type: 'Damage', effect: '-5/10% health'},
	0x07: {type: 'Damage', effect: '-2/5% health'},
	0x08: {type: 'Light',  effect: 'oscillates'},
	0x09: {type: 'Secret', effect: 'a player must stand in this sector to get credit for finding this secret. This is for the SECRETS ratio on inter-level screens.'},
	0x0a: {type: 'DOOR',   effect: '30 seconds after level start, ceiling closes like a door.'},
	0x0b: {type: 'End',    effect: '-10/20% health. If a player\'s health is lowered to less than 11% while standing here, then the level ends! Play proceeds to the next level. If it is a final level (levels 8 in DOOM 1, level 30 in DOOM 2), the game ends!'},
	0x0c: {type: 'Light',  effect: 'blink 0.5 second, synchronized'},
	0x0d: {type: 'Light',  effect: 'blink 1.0 second, synchronized'},
	0x0e: {type: 'DOOR',   effect: '300 seconds after level start, ceiling opens like a door.'},
	0x10: {type: 'Damage', effect: '-10/20% health'},
	0x11: {type: 'Light',  effect: 'flickers on and off randomly'},
	0x06: {type: '-',      effect: 'crushing ceiling'},
	0x0f: {type: '-',      effect: 'ammo creator'},
};
