import fs from 'node:fs';

const dec = new TextDecoder;

const SHORT = 2;
const INT  = 4;
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

class Map
{
	constructor(lumps, wad)
	{
		this.name = lumps.HEADER.name;

		Object.defineProperties(this, {
			lumps: {value: lumps, enumerable: true},
			wad: {value: wad},
			cache: {value: {}},
		});
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
		if(this.format === 'DOOM')
		{
			const THING_LEN  =  5*SHORT;
			const thingStart = this.lumps.THINGS.pos + THING_LEN * index;

			const x     = this.wad.view.getInt16(thingStart + 0*SHORT, true);
			const y     = this.wad.view.getInt16(thingStart + 1*SHORT, true);
			const angle = this.wad.view.getInt16(thingStart + 2*SHORT, true);
			const type  = this.wad.view.getInt16(thingStart + 3*SHORT, true);
			const flags = this.wad.view.getInt16(thingStart + 4*SHORT, true);

			return {x, y, angle, type, flags};
		}
		else if(this.format === 'HEXEN')
		{
			const THING_LEN  =  7*SHORT + 6*BYTE;
			const thingStart = this.lumps.THINGS.pos + THING_LEN * index;

			const id      = this.wad.view.getUint16(thingStart + 0*SHORT, true);
			const x       =  this.wad.view.getInt16(thingStart + 1*SHORT, true);
			const y       =  this.wad.view.getInt16(thingStart + 2*SHORT, true);
			const z       =  this.wad.view.getInt16(thingStart + 3*SHORT, true);
			const angle   =  this.wad.view.getUint16(thingStart + 4*SHORT, true);
			const type    = this.wad.view.getUint16(thingStart + 5*SHORT, true);
			const flags   = this.wad.view.getUint16(thingStart + 6*SHORT, true);

			const special =  this.wad.view.getUint8(thingStart + 7*SHORT + 0*BYTE, true);
			const arg1    =  this.wad.view.getUint8(thingStart + 7*SHORT + 1*BYTE, true);
			const arg2    =  this.wad.view.getUint8(thingStart + 7*SHORT + 2*BYTE, true);
			const arg3    =  this.wad.view.getUint8(thingStart + 7*SHORT + 3*BYTE, true);
			const arg4    =  this.wad.view.getUint8(thingStart + 7*SHORT + 4*BYTE, true);
			const arg5    =  this.wad.view.getUint8(thingStart + 7*SHORT + 5*BYTE, true);

			return {id, x, y, z, angle, type, flags, special, arg1, arg2, arg3, arg4, arg5, index};
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

			return {
				from,
				to,
				flags,
				types,
				tag,
				right,
				left: left < 0xFFFF ? left : -1,
				index,
			};
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

			const right   = this.wad.view.getUint16(linedefStart + 3*SHORT + 5*BYTE, true);
			const left    = this.wad.view.getUint16(linedefStart + 3*SHORT + 5*BYTE, true);

			return {
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
		}
	}

	get sidedefCount()
	{
		return Math.ceil(this.lumps.SIDEDEFS.size / SIDEDEF_LEN);
	}

	sidedef(index)
	{
		const sidedefStart = this.lumps.SIDEDEFS.pos + SIDEDEF_LEN * index;

		const xOffset = this.wad.view.getUint16(sidedefStart + 0*SHORT, true);
		const yOffset = this.wad.view.getUint16(sidedefStart + 1*SHORT, true);
		const upper   = decodeText(this.wad.bytes.slice(sidedefStart + 2*SHORT, sidedefStart + 2*SHORT + 8*CHAR));
		const lower   = decodeText(this.wad.bytes.slice(sidedefStart + 2*SHORT + 1*8*CHAR, sidedefStart + 2*SHORT + 2*8*CHAR));
		const middle  = decodeText(this.wad.bytes.slice(sidedefStart + 2*SHORT + 2*8*CHAR, sidedefStart + 2*SHORT + 3*8*CHAR));
		const sector  = this.wad.view.getUint16(sidedefStart + 2*SHORT + 3*8*CHAR, true);

		return {xOffset, yOffset, upper, lower, middle, sector, index};
	}

	get vertexCount()
	{
		return Math.ceil(this.lumps.VERTEXES.size / VERTEX_LEN);
	}

	vertex(index)
	{
		const vertexStart = this.lumps.VERTEXES.pos + VERTEX_LEN * index;

		const x = this.wad.view.getInt16(vertexStart + 0*SHORT, true);
		const y = this.wad.view.getInt16(vertexStart + 1*SHORT, true);

		return {x, y, index};
	}

	get segCount()
	{
		return Math.ceil(this.lumps.SEGS.size / VERTEX_LEN);
	}

	seg(index)
	{
		const segStart = this.lumps.SEGS.pos + SEG_LEN * index;

		const start   = this.wad.view.getUint16(segStart + 0*SHORT, true);
		const end     = this.wad.view.getUint16(segStart + 1*SHORT, true);
		const angle   = this.wad.view.getUint16(segStart + 2*SHORT, true);
		const linedef = this.wad.view.getUint16(segStart + 3*SHORT, true);
		const dir     = this.wad.view.getUint16(segStart + 4*SHORT, true);
		const offset  = this.wad.view.getUint16(segStart + 5*SHORT, true);

		return {start, end, angle, linedef, dir, offset, index};
	}

	get subsectorCount()
	{
		return Math.ceil(this.lumps.SSECTORS.size / SSECTOR_LEN);
	}

	subsector(index)
	{
		const subsectorStart = this.lumps.SSECTORS.pos + SSECTOR_LEN * index;

		const count = this.wad.view.getUint16(subsectorStart + 0*SHORT, true);
		const start = this.wad.view.getUint16(subsectorStart + 1*SHORT, true);

		return {count, start};
	}

	get nodeCount()
	{
		return Math.ceil(this.lumps.NODES.size / NODE_LEN);
	}

	node(index)
	{
		const nodeStart = this.lumps.NODES.pos + NODE_LEN * index;

		const x   = this.wad.view.getInt16(nodeStart + 0*SHORT, true);
		const y   = this.wad.view.getInt16(nodeStart + 1*SHORT, true);
		const dx  = this.wad.view.getInt16(nodeStart + 2*SHORT, true);
		const dy  = this.wad.view.getInt16(nodeStart + 3*SHORT, true);

		const right = {};
		const left = {};

		right.yUpper = this.wad.view.getInt16(nodeStart + 4*SHORT, true);
		right.yLower = this.wad.view.getInt16(nodeStart + 5*SHORT, true);
		right.xUpper = this.wad.view.getInt16(nodeStart + 6*SHORT, true);
		right.xLower = this.wad.view.getInt16(nodeStart + 7*SHORT, true);

		left.yUpper = this.wad.view.getInt16(nodeStart + 8*SHORT, true);
		left.yLower = this.wad.view.getInt16(nodeStart + 9*SHORT, true);
		left.xUpper = this.wad.view.getInt16(nodeStart + 10*SHORT, true);
		left.xLower = this.wad.view.getInt16(nodeStart + 11*SHORT, true);

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

		return {x, y, dx, dy, right, left, index};
	}

	get sectorCount()
	{
		return Math.ceil(this.lumps.SECTORS.size / SECTOR_LEN);
	}

	sector(index)
	{
		const sectorStart = this.lumps.SECTORS.pos + SECTOR_LEN * index;

		const floorHeight   = this.wad.view.getInt16(sectorStart + 0*SHORT, true);
		const ceilingHeight = this.wad.view.getInt16(sectorStart + 1*SHORT, true);
		const floorFlat     = decodeText(this.wad.bytes.slice(sectorStart + 2*SHORT, sectorStart + 2*SHORT + 8*CHAR));
		const ceilingFlat   = decodeText(this.wad.bytes.slice(sectorStart + 2*SHORT + 1*8*CHAR, sectorStart + 2*SHORT + 2*8*CHAR));
		const lightLevel    = this.wad.view.getUint16(sectorStart + 2*SHORT + 2*8*CHAR + 0*SHORT, true);
		const special       = this.wad.view.getUint16(sectorStart + 2*SHORT + 2*8*CHAR + 1*SHORT, true);
		const tag           = this.wad.view.getUint16(sectorStart + 2*SHORT + 2*8*CHAR + 2*SHORT, true);

		return {floorHeight, ceilingHeight, floorFlat, ceilingFlat, lightLevel, special, tag, index};
	}

	// REJECT
	// BLOCKMAP
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

		if(this.glVertVersion < 3)
		{
			const GL_VERT_LEN = VERTEX_LEN;
			const glVertexStart = this.lumps.GL_VERT.pos + GL_VERT_LEN * index;

			const x = this.wad.view.getInt16(glVertexStart + 0*SHORT, true);
			const y = this.wad.view.getInt16(glVertexStart + 1*SHORT, true);

			return {x, y};
		}
		else
		{
			const GL_VERT_LEN = 2*INT;
			const glVertexStart = 4 + this.lumps.GL_VERT.pos + GL_VERT_LEN * index;

			const x = this.wad.view.getInt16(glVertexStart + 0*INT, true);
			const y = this.wad.view.getInt16(glVertexStart + 1*INT, true);

			return {x, y, index};
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

		if(this.glSegVersion < 3)
		{
			const GL_SEG_LEN = 5*SHORT;
			const glSegStart = this.lumps.GL_SEGS.pos + GL_SEG_LEN * index;

			const start   = this.wad.view.getUint16(glSegStart + 0*SHORT, true);
			const end     = this.wad.view.getUint16(glSegStart + 1*SHORT, true);
			const linedef = this.wad.view.getUint16(glSegStart + 2*SHORT, true);
			const side    = this.wad.view.getUint16(glSegStart + 3*SHORT, true);
			const partner = this.wad.view.getUint16(glSegStart + 4*SHORT, true);

			return {
				start: start & ~(1 << 15),
				end: end & ~(1 << 15),
				startIsGlSeg: !!(start & (1 << 15)),
				endIsGlSeg: !!(end & (1 << 15)),
				linedef,
				side,
				partner,
				index,
			};
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

			return {
				start: start & ~(1 << 30),
				end: end & ~(1 << 30),
				startIsGlSeg: !!(start & (1 << 30)),
				endIsGlSeg: !!(end & (1 << 30)),
				linedef,
				side,
				partner,
				index,
			};
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

			return {
				start: start & ~(1 << 31),
				end: end & ~(1 << 31),
				startIsGlSeg: !!(start & (1 << 31)),
				endIsGlSeg: !!(end & (1 << 31)),
				linedef,
				side,
				partner,
				index,
			};
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

	get glSubsectCount()
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

	glSubsect(index)
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

			return {count, first, index};
		}
		else if(this.glSubsectVersion < 5)
		{
			const GL_SSECT_LEN = 2*INT;
			const glSubsectStart = 4 + this.lumps.GL_SSECT.pos + GL_SSECT_LEN * index;

			const count = this.wad.view.getUint32(glSubsectStart + 0*INT, true);
			const first = this.wad.view.getUint32(glSubsectStart + 1*INT, true);

			return {count, first};
		}
		else
		{
			const GL_SSECT_LEN = 2*INT;
			const glSubsectStart = this.lumps.GL_SSECT.pos + GL_SSECT_LEN * index;

			const count = this.wad.view.getUint32(glSubsectStart + 0*INT, true);
			const first = this.wad.view.getUint32(glSubsectStart + 1*INT, true);

			return {count, first, index};
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
			const left = {};

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

			return {x, y, dx, dy, right, left, index};
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

			return {x, y, dx, dy, right, left, index};
		}
	}

	// GL_PVS
	// WADCSRC

	get bounds()
	{
		if('glSubsectVersion' in this.cache)
		{
			return this.cache.bounds;
		}

		let xMin = Infinity, yMin = Infinity;
		let xMax = -Infinity, yMax = -Infinity;

		for(let i = 0; i < this.vertexCount; i++)
		{
			const vertex = this.vertex(i);

			xMin = Math.min(vertex.x, xMin);
			yMin = Math.min(vertex.y, yMin);

			xMax = Math.max(vertex.x, xMax);
			yMax = Math.max(vertex.y, yMax);
		}

		return this.cache.bounds = Object.freeze({xMin, yMin, xMax, yMax});
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
			glSubsects.push( this.glSubsect(i) );
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
}

class Wad
{
	constructor(rawBytes)
	{
		Object.defineProperty(this, 'bytes', {value: new Uint8Array(rawBytes)});
		Object.defineProperty(this, 'view', {value: new DataView(this.bytes.buffer)});
		Object.defineProperty(this, 'cache', {value: {}});
		Object.defineProperty(this, 'index', {value: {}});

		for(let i = 0; i < this.lumpCount; i++)
		{
			const entry = this.getDirEntry(i);
			this.index[entry.name] = entry;
		}

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

		for(let i = 0; i < wad.lumpCount; i++)
		{
			const entry = wad.getDirEntry(i);

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
			return decodeText(this.getLump(entry.index));
		}
	}

	get lumpCount()
	{
		return this.view.getUint32(4, true);
	}

	get dirStart()
	{
		return this.view.getUint32(8, true);
	}

	getDirEntry(index)
	{
		const entryStart = this.dirStart + index * DIR_ENTRY_LEN;

		const pos = this.view.getUint32(entryStart, true);
		const size = this.view.getUint32(entryStart + 4, true);

		const nameStart = entryStart + 8;

		const name = decodeText(this.bytes.slice(nameStart, nameStart + 8));

		return {index, pos, size, name};
	}

	getEntryByName(name)
	{
		return this.index[name];
	}

	getLump(index)
	{
		const entry = this.getDirEntry(index);
		return this.bytes.slice(entry.pos, entry.pos + entry.size);
	}

	loadMap(mapName)
	{
		const HEADER = this.getEntryByName(mapName);
		const lumps = {HEADER};

		for(let i = 1 + HEADER.index; i < this.lumpCount; i++)
		{
			const entry = this.getDirEntry(i);

			if(!MAP_LUMPS.includes(entry.name) && entry.name !== ('GL_' + mapName).substr(0, 8))
			{
				break;
			}

			lumps[ entry.name ] = entry;
		}

		return new Map(lumps, wad);
	}
}

const args = process.argv.slice(2);
const [wadFile, mapName] = args;
const wad = new Wad( fs.readFileSync(wadFile) );

// console.log(`${wad.type} ${wad.format} ${wadFile}`);
// console.log(wad.info);

if(mapName)
{
	const map = wad.loadMap(mapName);

	// console.log(`<svg height="1000" width="1000" viewBox="-1000 -5000 5000 5000" xmlns="http://www.w3.org/2000/svg">`);
	console.log(`<svg viewBox="${map.bounds.xMin} ${map.bounds.yMin} ${map.bounds.xMax - map.bounds.xMin} ${map.bounds.yMax - map.bounds.yMin}" xmlns="http://www.w3.org/2000/svg" style = "transform: scaleY(-1);">`);

	for(let i = 0; i < map.linedefCount; i++)
	{
		const linedef = map.linedef(i);
		const from = map.vertex(linedef.from);
		const to = map.vertex(linedef.to);
		const right = map.sidedef(linedef.right);
		const rSector = map.sector(right.sector);
		// const left = linedef.left >= 0 ? map.sidedef(linedef.left) : false;
		// const lSector = left && map.sector(left.sector);
		console.error({sector: rSector.index});
		console.log(
			`  <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" data-sector="${rSector.index}" data-tag = "${linedef.tag}" style="stroke:black;stroke-width:2;" />`
		);
		// console.log(linedef, from, to);
	}

	console.log(`</svg>`);

	// console.log(map.name);
	// console.log(map.format);
	// console.log(map);

	// console.log({
	// 	thingCount: map.thingCount,
	// 	linedefCount: map.linedefCount,
	// 	sidedefCount: map.sidedefCount,
	// 	vertexCount: map.vertexCount,
	// 	segCount: map.segCount,
	// 	subsectorCount: map.subsectorCount,
	// 	nodeCount: map.nodeCount,
	// 	sectorCount: map.sectorCount,
	// 	glVertVersion: map.glVertVersion,
	// 	glSegVersion: map.glSegVersion,
	// 	glSubsectVersion: map.glSubsectVersion,
	// 	glNodeVersion: map.glNodeVersion,
	// 	glVertCount: map.glVertCount,
	// 	glSegCount: map.glSegCount,
	// 	glSubsectCount: map.glSubsectCount,
	// 	glNodeCount: map.glNodeCount,
	// });

	// console.log( JSON.stringify(map.dump()) );
	// console.log( map.dump() );
}
else
{
	for(let i = 0; i < wad.lumpCount; i++)
	{
		const entry = wad.getDirEntry(i);
		console.log( entry );
	}
}
