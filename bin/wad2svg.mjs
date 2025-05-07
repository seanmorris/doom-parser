#!/usr/bin/env node

import fs from 'node:fs';
import { Wad, WadLoader } from '../Wad.mjs';

const args = process.argv.slice(2);
const [wadFile, mapName] = args;

const wad = new WadLoader(
	fs.readFileSync(wadFile)
);

console.error(`${wad.type} ${wad.format} ${wadFile}`);
console.error(wad.info);

if(mapName)
{
	const map = wad.loadMap(mapName);

	{
		console.error(map.name);
		console.error(map.format);

		console.error({
			thingCount: map.thingCount,
			linedefCount: map.linedefCount,
			sidedefCount: map.sidedefCount,
			vertexCount: map.vertexCount,
			segCount: map.segCount,
			subsectorCount: map.subsectorCount,
			nodeCount: map.nodeCount,
			sectorCount: map.sectorCount,
			glVertVersion: map.glVertVersion,
			glSegVersion: map.glSegVersion,
			glSubsectVersion: map.glSubsectVersion,
			glNodeVersion: map.glNodeVersion,
			glVertCount: map.glVertCount,
			glSegCount: map.glSegCount,
			glSubsectorCount: map.glSubsectorCount,
			glNodeCount: map.glNodeCount,
		});
	}

	console.log(`<svg viewBox="${map.bounds.xMin} ${map.bounds.yMin} ${map.bounds.xMax - map.bounds.xMin} ${map.bounds.yMax - map.bounds.yMin}" xmlns="http://www.w3.org/2000/svg" style = "transform: scaleY(-1);">
<style>polygon { fill:transparent; transition:fill 1s ease-out; } polygon:hover { fill: red; transition:fill 0s; }</style>`);

	for(let i = 0; i < map.linedefCount; i++)
	{
		const linedef = map.linedef(i);

		const from = map.vertex(linedef.from);
		const to   = map.vertex(linedef.to);

		const right = map.sidedef(linedef.right);
		const left  = linedef.left >= 0 ? map.sidedef(linedef.left) : false;

		const rSector = map.sector(right.sector);
		const lSector = left && map.sector(left.sector);

		console.log(`<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" style="stroke:black;stroke-width:1;" />`);
	}

	let k = 0;

	for(let i = 0; i < map.glSubsectorCount; i++)
	{
		const glSubsector = map.glSubsector(i);
		const vertexes = glSubsector.vertexes();
		const bounds = glSubsector.bounds;
		const verts = vertexes.map(v => `${v.x},${v.y}`).join(' ');
		console.log(`<polygon data-glssect = "${glSubsector.index}" points="${verts}" style = "stroke:#800000;stroke-width:1;" />`);
	}

	console.log(`</svg>`);
}
else
{
	for(let i = 0; i < wad.lumpCount; i++)
	{
		const entry = wad.getDirEntry(i);
		console.log( entry );
	}
}
