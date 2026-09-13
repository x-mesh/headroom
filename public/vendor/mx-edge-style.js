/*
 * mxGraph edge routing, vendored.
 *
 * Upstream: https://github.com/jgraph/mxgraph (shipped inside draw.io)
 * Files:    src/view/mxEdgeStyle.js, src/view/mxPerimeter.js,
 *           src/util/mxUtils.js, src/util/mxConstants.js
 * Licence:  Apache-2.0. See vendor/mxgraph/NOTICE.md and PROVENANCE.json.
 *
 * Only the members drawio-import.js needs are copied, byte for byte apart
 * from the module wrapper. Do not hand-edit: the routing has to stay
 * identical to draw.io or imported diagrams stop matching their source.
 */

// mxPoint and mxRectangle, copied so the routing gets the whole class. Hand
// written stubs kept losing a method the copied code calls only for a rotated
// terminal, and the import died at that one shape.
/**
 * Class: mxPoint
 *
 * Implements a 2-dimensional vector with double precision coordinates.
 * 
 * Constructor: mxPoint
 *
 * Constructs a new point for the optional x and y coordinates. If no
 * coordinates are given, then the default values for <x> and <y> are used.
 */
function mxPoint(x, y)
{
	this.x = (x != null) ? x : 0;
	this.y = (y != null) ? y : 0;
};

/**
 * Variable: x
 *
 * Holds the x-coordinate of the point. Default is 0.
 */
mxPoint.prototype.x = null;

/**
 * Variable: y
 *
 * Holds the y-coordinate of the point. Default is 0.
 */
mxPoint.prototype.y = null;

/**
 * Function: equals
 * 
 * Returns true if the given object equals this point.
 */
mxPoint.prototype.equals = function(obj)
{
	return obj != null && obj.x == this.x && obj.y == this.y;
};

/**
 * Function: clone
 *
 * Returns a clone of this <mxPoint>.
 */
mxPoint.prototype.clone = function()
{
	// Handles subclasses as well
	return mxUtils.clone(this);
};

/**
 * Class: mxRectangle
 *
 * Extends <mxPoint> to implement a 2-dimensional rectangle with double
 * precision coordinates.
 * 
 * Constructor: mxRectangle
 *
 * Constructs a new rectangle for the optional parameters. If no parameters
 * are given then the respective default values are used.
 */
function mxRectangle(x, y, width, height)
{
	mxPoint.call(this, x, y);

	this.width = (width != null) ? width : 0;
	this.height = (height != null) ? height : 0;
};

/**
 * Extends mxPoint.
 */
mxRectangle.prototype = new mxPoint();
mxRectangle.prototype.constructor = mxRectangle;

/**
 * Variable: width
 *
 * Holds the width of the rectangle. Default is 0.
 */
mxRectangle.prototype.width = null;

/**
 * Variable: height
 *
 * Holds the height of the rectangle. Default is 0.
 */
mxRectangle.prototype.height = null;

/**
 * Function: setRect
 * 
 * Sets this rectangle to the specified values
 */
mxRectangle.prototype.setRect = function(x, y, w, h)
{
    this.x = x;
    this.y = y;
    this.width = w;
    this.height = h;
};

/**
 * Function: getCenterX
 * 
 * Returns the x-coordinate of the center point.
 */
mxRectangle.prototype.getCenterX = function ()
{
	return this.x + this.width/2;
};

/**
 * Function: getCenterY
 * 
 * Returns the y-coordinate of the center point.
 */
mxRectangle.prototype.getCenterY = function ()
{
	return this.y + this.height/2;
};

/**
 * Function: add
 *
 * Adds the given rectangle to this rectangle.
 */
mxRectangle.prototype.add = function(rect)
{
	if (rect != null)
	{
		var minX = Math.min(this.x, rect.x);
		var minY = Math.min(this.y, rect.y);
		var maxX = Math.max(this.x + this.width, rect.x + rect.width);
		var maxY = Math.max(this.y + this.height, rect.y + rect.height);
		
		this.x = minX;
		this.y = minY;
		this.width = maxX - minX;
		this.height = maxY - minY;
	}
};

/**
 * Function: intersect
 * 
 * Changes this rectangle to where it overlaps with the given rectangle.
 */
mxRectangle.prototype.intersect = function(rect)
{
	if (rect != null)
	{
		var r1 = this.x + this.width;
		var r2 = rect.x + rect.width;
		
		var b1 = this.y + this.height;
		var b2 = rect.y + rect.height;
		
		this.x = Math.max(this.x, rect.x);
		this.y = Math.max(this.y, rect.y);
		this.width = Math.min(r1, r2) - this.x;
		this.height = Math.min(b1, b2) - this.y;
	}
};

/**
 * Function: intersectsPoint
 * 
 * Returns true if the given point is inside this rectangle.
 */
mxRectangle.prototype.intersectsPoint = function(x, y)
{
	return x >= this.x && x <= this.x + this.width &&
	       y >= this.y && y <= this.y + this.height;
};

/**
 * Function: grow
 *
 * Grows the rectangle by the given amount, that is, this method subtracts
 * the given amount from the x- and y-coordinates and adds twice the amount
 * to the width and height.
 */
mxRectangle.prototype.grow = function(amount)
{
	this.x -= amount;
	this.y -= amount;
	this.width += 2 * amount;
	this.height += 2 * amount;
	
	return this;
};

/**
 * Function: getPoint
 * 
 * Returns the top, left corner as a new <mxPoint>.
 */
mxRectangle.prototype.getPoint = function()
{
	return new mxPoint(this.x, this.y);
};

/**
 * Function: rotate90
 * 
 * Rotates this rectangle by 90 degree around its center point.
 */
mxRectangle.prototype.rotate90 = function()
{
	var t = (this.width - this.height) / 2;
	this.x += t;
	this.y -= t;
	var tmp = this.width;
	this.width = this.height;
	this.height = tmp;
};

/**
 * Function: equals
 * 
 * Returns true if the given object equals this rectangle.
 */
mxRectangle.prototype.equals = function(obj)
{
	return obj != null && obj.x == this.x && obj.y == this.y &&
		obj.width == this.width && obj.height == this.height;
};

/**
 * Function: fromPoint
 * 
 * Returns a new <mxRectangle> from the given <mxPoint>.
 */
mxRectangle.fromPoint = function(pt)
{
	return new mxRectangle(pt.x, pt.y, 0, 0);
};

/**
 * Function: fromRectangle
 * 
 * Returns a new <mxRectangle> which is a copy of the given rectangle.
 */
mxRectangle.fromRectangle = function(rect)
{
	return new mxRectangle(rect.x, rect.y, rect.width, rect.height);
};

export { mxPoint, mxRectangle };

const mxConstants = {
  DEFAULT_MARKERSIZE: 6,
  DIRECTION_MASK_ALL: 15,
  DIRECTION_MASK_EAST: 8,
  DIRECTION_MASK_NORTH: 2,
  DIRECTION_MASK_SOUTH: 4,
  DIRECTION_MASK_WEST: 1,
  NONE: 'none',
  STYLE_ENDARROW: 'endArrow',
  STYLE_ENDSIZE: 'endSize',
  STYLE_JETTY_SIZE: 'jettySize',
  STYLE_ROTATION: 'rotation',
  STYLE_SOURCE_JETTY_SIZE: 'sourceJettySize',
  STYLE_STARTARROW: 'startArrow',
  STYLE_STARTSIZE: 'startSize',
  STYLE_TARGET_JETTY_SIZE: 'targetJettySize',
  DIRECTION_MASK_NONE: 0,
  STYLE_PORT_CONSTRAINT: 'portConstraint',
  STYLE_PORT_CONSTRAINT_ROTATION: 'portConstraintRotation',
  STYLE_DIRECTION: 'direction',
  DIRECTION_NORTH: 'north',
  DIRECTION_SOUTH: 'south',
  DIRECTION_EAST: 'east',
  DIRECTION_WEST: 'west',
};

// mxUtils.clone tests `obj.constructor === Element`, which only exists in a
// browser. Tests and the corpus harness run this in node, so stand a value in
// that nothing can equal rather than editing the copied branch.
const Element = globalThis.Element ?? class {};

const mxObjectIdentity = { FIELD_NAME: 'mxObjectId' };

const mxUtils = {
	clone: function(obj, transients, shallow)
	{
		shallow = (shallow != null) ? shallow : false;
		var clone = null;
		
		if (obj != null && typeof(obj.constructor) == 'function')
		{
			if (obj.constructor === Element)
			{
				clone = obj.cloneNode((shallow != null) ? !shallow : false);
			}
			else
			{
				clone = new obj.constructor();
				
				for (var i in obj)
				{
					if (i != mxObjectIdentity.FIELD_NAME && (transients == null ||
						mxUtils.indexOf(transients, i) < 0))
					{
						if (!shallow && typeof(obj[i]) == 'object')
						{
							clone[i] = mxUtils.clone(obj[i]);
						}
						else
						{
							clone[i] = obj[i];
						}
					}
				}
			}
		}
		
	    return clone;
	},

	contains: function(bounds, x, y)
	{
		return (bounds.x <= x && bounds.x + bounds.width >= x &&
				bounds.y <= y && bounds.y + bounds.height >= y);
	},

	getBoundingBox: function(rect, rotation, cx)
	{
        var result = null;

        if (rect != null && rotation != null && rotation != 0)
        {
            var rad = mxUtils.toRadians(rotation);
            var cos = Math.cos(rad);
            var sin = Math.sin(rad);

            cx = (cx != null) ? cx : new mxPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);

            var p1 = new mxPoint(rect.x, rect.y);
            var p2 = new mxPoint(rect.x + rect.width, rect.y);
            var p3 = new mxPoint(p2.x, rect.y + rect.height);
            var p4 = new mxPoint(rect.x, p3.y);

            p1 = mxUtils.getRotatedPoint(p1, cos, sin, cx);
            p2 = mxUtils.getRotatedPoint(p2, cos, sin, cx);
            p3 = mxUtils.getRotatedPoint(p3, cos, sin, cx);
            p4 = mxUtils.getRotatedPoint(p4, cos, sin, cx);

            result = new mxRectangle(p1.x, p1.y, 0, 0);
            result.add(new mxRectangle(p2.x, p2.y, 0, 0));
            result.add(new mxRectangle(p3.x, p3.y, 0, 0));
            result.add(new mxRectangle(p4.x, p4.y, 0, 0));
        }

        return result;
	},

	getNumber: function(array, key, defaultValue)
	{
		var value = (array != null) ? array[key] : null;

		if (value == null)
		{
			value = defaultValue || 0;
		}
		
		return Number(value);
	},

	getPortConstraints: function(terminal, edge, source, defaultValue)
	{
		var value = mxUtils.getValue(terminal.style, mxConstants.STYLE_PORT_CONSTRAINT,
			mxUtils.getValue(edge.style, (source) ? mxConstants.STYLE_SOURCE_PORT_CONSTRAINT :
				mxConstants.STYLE_TARGET_PORT_CONSTRAINT, null));
		
		if (value == null)
		{
			return defaultValue;
		}
		else
		{
			var directions = value.toString();
			var returnValue = mxConstants.DIRECTION_MASK_NONE;
			var constraintRotationEnabled = mxUtils.getValue(terminal.style, mxConstants.STYLE_PORT_CONSTRAINT_ROTATION, 0);
			var rotation = 0;
			
			if (constraintRotationEnabled == 1)
			{
				rotation = mxUtils.getValue(terminal.style, mxConstants.STYLE_ROTATION, 0);
			}
			
			var quad = 0;

			if (rotation > 45)
			{
				quad = 1;
				
				if (rotation >= 135)
				{
					quad = 2;
				}
			}
			else if (rotation < -45)
			{
				quad = 3;
				
				if (rotation <= -135)
				{
					quad = 2;
				}
			}

			if (directions.indexOf(mxConstants.DIRECTION_NORTH) >= 0)
			{
				switch (quad)
				{
					case 0:
						returnValue |= mxConstants.DIRECTION_MASK_NORTH;
						break;
					case 1:
						returnValue |= mxConstants.DIRECTION_MASK_EAST;
						break;
					case 2:
						returnValue |= mxConstants.DIRECTION_MASK_SOUTH;
						break;
					case 3:
						returnValue |= mxConstants.DIRECTION_MASK_WEST;
						break;
				}
			}
			if (directions.indexOf(mxConstants.DIRECTION_WEST) >= 0)
			{
				switch (quad)
				{
					case 0:
						returnValue |= mxConstants.DIRECTION_MASK_WEST;
						break;
					case 1:
						returnValue |= mxConstants.DIRECTION_MASK_NORTH;
						break;
					case 2:
						returnValue |= mxConstants.DIRECTION_MASK_EAST;
						break;
					case 3:
						returnValue |= mxConstants.DIRECTION_MASK_SOUTH;
						break;
				}
			}
			if (directions.indexOf(mxConstants.DIRECTION_SOUTH) >= 0)
			{
				switch (quad)
				{
					case 0:
						returnValue |= mxConstants.DIRECTION_MASK_SOUTH;
						break;
					case 1:
						returnValue |= mxConstants.DIRECTION_MASK_WEST;
						break;
					case 2:
						returnValue |= mxConstants.DIRECTION_MASK_NORTH;
						break;
					case 3:
						returnValue |= mxConstants.DIRECTION_MASK_EAST;
						break;
				}
			}
			if (directions.indexOf(mxConstants.DIRECTION_EAST) >= 0)
			{
				switch (quad)
				{
					case 0:
						returnValue |= mxConstants.DIRECTION_MASK_EAST;
						break;
					case 1:
						returnValue |= mxConstants.DIRECTION_MASK_SOUTH;
						break;
					case 2:
						returnValue |= mxConstants.DIRECTION_MASK_WEST;
						break;
					case 3:
						returnValue |= mxConstants.DIRECTION_MASK_NORTH;
						break;
				}
			}

			return returnValue;
		}
	},

	getRotatedPoint: function(pt, cos, sin, c)
	{
		c = (c != null) ? c : new mxPoint();
		var x = pt.x - c.x;
		var y = pt.y - c.y;

		var x1 = x * cos - y * sin;
		var y1 = y * cos + x * sin;

		return new mxPoint(x1 + c.x, y1 + c.y);
	},

	getValue: function(array, key, defaultValue)
	{
		var value = (array != null) ? array[key] : null;

		if (value == null)
		{
			value = defaultValue;			
		}
		
		return value;
	},

	reversePortConstraints: function(constraint)
	{
		var result = 0;
		
		result = (constraint & mxConstants.DIRECTION_MASK_WEST) << 3;
		result |= (constraint & mxConstants.DIRECTION_MASK_NORTH) << 1;
		result |= (constraint & mxConstants.DIRECTION_MASK_SOUTH) >> 1;
		result |= (constraint & mxConstants.DIRECTION_MASK_EAST) >> 3;
		
		return result;
	},

	toRadians: function(deg)
	{
		return Math.PI * deg / 180;
	},

	indexOf: function(array, obj)
	{
		if (array != null && obj != null)
		{
			for (var i = 0; i < array.length; i++)
			{
				if (array[i] == obj)
				{
					return i;
				}
			}
		}
		
		return -1;
	},
};

const mxLog = { show() {}, debug() {} };

export const mxEdgeStyle = {
	SegmentConnector: function(state, sourceScaled, targetScaled, controlHints, result)
	{
		// Creates array of all way- and terminalpoints
		var pts = mxEdgeStyle.scalePointArray(state.absolutePoints, state.view.scale);
		var source = mxEdgeStyle.scaleCellState(sourceScaled, state.view.scale);
		var target = mxEdgeStyle.scaleCellState(targetScaled, state.view.scale);
		var tol = 1;
		
		// Adds translated unscaled points for precise collision checks
		var tempPoints = []; 

		function addPoint(pt)
		{
			tempPoints.push(pt);
		};
		
		// Whether the first segment outgoing from the source end is horizontal
		var lastPushed = (result.length > 0) ? result[0] : null;
		var horizontal = true;
		var hint = null;
		
		// Adds waypoints only if outside of tolerance
		function pushPoint(pt)
		{
			pt.x = Math.round(pt.x * state.view.scale * 10) / 10;
			pt.y = Math.round(pt.y * state.view.scale * 10) / 10;

			if (lastPushed == null || Math.abs(lastPushed.x - pt.x) >= tol || Math.abs(lastPushed.y - pt.y) >= Math.max(1, state.view.scale))
			{
				result.push(pt);
				lastPushed = pt;
			}
			
			return lastPushed;
		};

		// Adds the first point
		var pt = pts[0];
		
		if (pt == null && source != null)
		{
			pt = new mxPoint(state.view.getRoutingCenterX(source), state.view.getRoutingCenterY(source));
		}
		else if (pt != null)
		{
			pt = pt.clone();
		}
		
		var lastInx = pts.length - 1;

		// Adds the waypoints
		if (controlHints != null && controlHints.length > 0)
		{
			// Converts all hints and removes nulls
			var hints = [];
			
			for (var i = 0; i < controlHints.length; i++)
			{
				var tmp = state.view.transformControlPoint(state, controlHints[i], true);
				
				if (tmp != null)
				{
					hints.push(tmp);
				}
			}
			
			if (hints.length == 0)
			{
				return;
			}
			
			// Aligns source and target hint to fixed points
			if (pt != null && hints[0] != null)
			{
				if (Math.abs(hints[0].x - pt.x) < tol)
				{
					hints[0].x = pt.x;
				}
				
				if (Math.abs(hints[0].y - pt.y) < tol)
				{
					hints[0].y = pt.y;
				}
			}
			
			var pe = pts[lastInx];
			
			if (pe != null && hints[hints.length - 1] != null)
			{
				if (Math.abs(hints[hints.length - 1].x - pe.x) < tol)
				{
					hints[hints.length - 1].x = pe.x;
				}
				
				if (Math.abs(hints[hints.length - 1].y - pe.y) < tol)
				{
					hints[hints.length - 1].y = pe.y;
				}
			}
			
			hint = hints[0];

			var currentTerm = source;
			var currentPt = pts[0];
			var hozChan = false;
			var vertChan = false;
			var currentHint = hint;
			
			if (currentPt != null)
			{
				currentTerm = null;
			}
			
			// Check for alignment with fixed points and with channels
			// at source and target segments only
			for (var i = 0; i < 2; i++)
			{
				var fixedVertAlign = currentPt != null && currentPt.x == currentHint.x;
				var fixedHozAlign = currentPt != null && currentPt.y == currentHint.y;
				
				var inHozChan = currentTerm != null && (currentHint.y >= currentTerm.y &&
						currentHint.y <= currentTerm.y + currentTerm.height);
				var inVertChan = currentTerm != null && (currentHint.x >= currentTerm.x &&
						currentHint.x <= currentTerm.x + currentTerm.width);

				hozChan = fixedHozAlign || (currentPt == null && inHozChan);
				vertChan = fixedVertAlign || (currentPt == null && inVertChan);
				
				// If the current hint falls in both the hor and vert channels in the case
				// of a floating port, or if the hint is exactly co-incident with a 
				// fixed point, ignore the source and try to work out the orientation
				// from the target end
				if (i==0 && ((hozChan && vertChan) || (fixedVertAlign && fixedHozAlign)))
				{
				}
				else
				{
					if (currentPt != null && (!fixedHozAlign && !fixedVertAlign) && (inHozChan || inVertChan)) 
					{
						horizontal = inHozChan ? false : true;
						break;
					}
			
					if (vertChan || hozChan)
					{
						horizontal = hozChan;
						
						if (i == 1)
						{
							// Work back from target end
							horizontal = hints.length % 2 == 0 ? hozChan : vertChan;
						}
	
						break;
					}
				}
				
				currentTerm = target;
				currentPt = pts[lastInx];
				
				if (currentPt != null)
				{
					currentTerm = null;
				}
				
				currentHint = hints[hints.length - 1];
				
				if (fixedVertAlign && fixedHozAlign)
				{
					hints = hints.slice(1);
				}
			}

			if (horizontal && ((pts[0] != null && pts[0].y != hint.y) ||
				(pts[0] == null && source != null &&
				(hint.y < source.y || hint.y > source.y + source.height))))
			{
				addPoint(new mxPoint(pt.x, hint.y));
			}
			else if (!horizontal && ((pts[0] != null && pts[0].x != hint.x) ||
					(pts[0] == null && source != null &&
					(hint.x < source.x || hint.x > source.x + source.width))))
			{
				addPoint(new mxPoint(hint.x, pt.y));
			}
			
			if (horizontal)
			{
				pt.y = hint.y;
			}
			else
			{
				pt.x = hint.x;
			}
		
			for (var i = 0; i < hints.length; i++)
			{
				horizontal = !horizontal;
				hint = hints[i];
				
//				mxLog.show();
//				mxLog.debug('hint', i, hint.x, hint.y);
				
				if (horizontal)
				{
					pt.y = hint.y;
				}
				else
				{
					pt.x = hint.x;
				}
		
				addPoint(pt.clone());
			}
		}
		else
		{
			hint = pt;
			// FIXME: First click in connect preview toggles orientation
			horizontal = true;
		}

		// Adds the last point
		pt = pts[lastInx];

		if (pt == null && target != null)
		{
			pt = new mxPoint(state.view.getRoutingCenterX(target), state.view.getRoutingCenterY(target));
		}
		
		if (pt != null)
		{
			if (hint != null)
			{
				if (horizontal && ((pts[lastInx] != null && pts[lastInx].y != hint.y) ||
					(pts[lastInx] == null && target != null &&
					(hint.y < target.y || hint.y > target.y + target.height))))
				{
					addPoint(new mxPoint(pt.x, hint.y));
				}
				else if (!horizontal && ((pts[lastInx] != null && pts[lastInx].x != hint.x) ||
						(pts[lastInx] == null && target != null &&
						(hint.x < target.x || hint.x > target.x + target.width))))
				{
					addPoint(new mxPoint(hint.x, pt.y));
				}
			}
		}
		
		// Removes bends inside the source terminal
		if (pts[0] == null && source != null)
		{
			while (tempPoints.length > 0 && tempPoints[0] != null &&
				mxUtils.contains(source, tempPoints[0].x, tempPoints[0].y))
			{
				tempPoints.splice(0, 1);
			}
		}
		
		// Removes bends inside the target terminal
		if (pts[lastInx] == null && target != null)
		{
			while (tempPoints.length > 0 && tempPoints[tempPoints.length - 1] != null &&
				mxUtils.contains(target, tempPoints[tempPoints.length - 1].x, tempPoints[tempPoints.length - 1].y))
			{
				tempPoints.splice(tempPoints.length - 1, 1);
			}
		}
		
		// Scales and smoothens edges
		for (var i = 0; i < tempPoints.length; i++)
		{
			pushPoint(tempPoints[i]);
		}
		
		// Removes last point if inside tolerance with end point
		if (pe != null && result[result.length - 1] != null &&
			Math.abs(pe.x - result[result.length - 1].x) <= tol &&
			Math.abs(pe.y - result[result.length - 1].y) <= tol)
		{
			result.splice(result.length - 1, 1);
			
			// Lines up second last point in result with end point
			if (result[result.length - 1] != null)
			{
				if (Math.abs(result[result.length - 1].x - pe.x) < tol)
				{
					result[result.length - 1].x = pe.x;
				}
				
				if (Math.abs(result[result.length - 1].y - pe.y) < tol)
				{
					result[result.length - 1].y = pe.y;
				}
			}
		}
	},
	
	orthBuffer: 10,
	
	orthPointsFallback: true,

	dirVectors: [ [ -1, 0 ],
			[ 0, -1 ], [ 1, 0 ], [ 0, 1 ], [ -1, 0 ], [ 0, -1 ], [ 1, 0 ] ],

	wayPoints1: [ [ 0, 0], [ 0, 0],  [ 0, 0], [ 0, 0], [ 0, 0],  [ 0, 0],
	              [ 0, 0],  [ 0, 0], [ 0, 0],  [ 0, 0], [ 0, 0],  [ 0, 0] ],

	routePatterns: [
		[ [ 513, 2308, 2081, 2562 ], [ 513, 1090, 514, 2184, 2114, 2561 ],
			[ 513, 1090, 514, 2564, 2184, 2562 ],
			[ 513, 2308, 2561, 1090, 514, 2568, 2308 ] ],
	[ [ 514, 1057, 513, 2308, 2081, 2562 ], [ 514, 2184, 2114, 2561 ],
			[ 514, 2184, 2562, 1057, 513, 2564, 2184 ],
			[ 514, 1057, 513, 2568, 2308, 2561 ] ],
	[ [ 1090, 514, 1057, 513, 2308, 2081, 2562 ], [ 2114, 2561 ],
			[ 1090, 2562, 1057, 513, 2564, 2184 ],
			[ 1090, 514, 1057, 513, 2308, 2561, 2568 ] ],
	[ [ 2081, 2562 ], [ 1057, 513, 1090, 514, 2184, 2114, 2561 ],
			[ 1057, 513, 1090, 514, 2184, 2562, 2564 ],
			[ 1057, 2561, 1090, 514, 2568, 2308 ] ] ],
	
	inlineRoutePatterns: [
			[ null, [ 2114, 2568 ], null, null ],
			[ null, [ 514, 2081, 2114, 2568 ] , null, null ],
			[ null, [ 2114, 2561 ], null, null ],
			[ [ 2081, 2562 ], [ 1057, 2114, 2568 ],
					[ 2184, 2562 ],
					null ] ],
	vertexSeperations: [],

	limits: [
	       [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
	       [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ] ],

	LEFT_MASK: 32,

	TOP_MASK: 64,

	RIGHT_MASK: 128,

	BOTTOM_MASK: 256,

	LEFT: 1,

	TOP: 2,

	RIGHT: 4,

	BOTTOM: 8,

	// TODO remove magic numbers
	SIDE_MASK: 480,
	//mxEdgeStyle.LEFT_MASK | mxEdgeStyle.TOP_MASK | mxEdgeStyle.RIGHT_MASK
	//| mxEdgeStyle.BOTTOM_MASK,

	CENTER_MASK: 512,

	SOURCE_MASK: 1024,

	TARGET_MASK: 2048,

	VERTEX_MASK: 3072,
	// mxEdgeStyle.SOURCE_MASK | mxEdgeStyle.TARGET_MASK,
	
	getJettySize: function(state, isSource)
	{
		var value = mxUtils.getValue(state.style, (isSource) ? mxConstants.STYLE_SOURCE_JETTY_SIZE :
			mxConstants.STYLE_TARGET_JETTY_SIZE, mxUtils.getValue(state.style,
					mxConstants.STYLE_JETTY_SIZE, mxEdgeStyle.orthBuffer));
		
		if (value == 'auto')
		{
			// Computes the automatic jetty size
			var type = mxUtils.getValue(state.style, (isSource) ? mxConstants.STYLE_STARTARROW : mxConstants.STYLE_ENDARROW, mxConstants.NONE);
			
			if (type != mxConstants.NONE)
			{
				var size = mxUtils.getNumber(state.style, (isSource) ? mxConstants.STYLE_STARTSIZE : mxConstants.STYLE_ENDSIZE, mxConstants.DEFAULT_MARKERSIZE);
				value = Math.max(2, Math.ceil((size + mxEdgeStyle.orthBuffer) / mxEdgeStyle.orthBuffer)) * mxEdgeStyle.orthBuffer;
			}
			else
			{
				value = 2 * mxEdgeStyle.orthBuffer;
			}
		}
		
		return value;
	},
	
	/**
	 * Function: scalePointArray
	 * 
	 * Scales an array of <mxPoint>
	 * 
	 * Parameters:
	 * 
	 * points - array of <mxPoint> to scale
	 * scale - the scaling to divide by
	 * 
	 */
	scalePointArray: function(points, scale)
	{
		var result = [];

		if (points != null)
		{
			for (var i = 0; i < points.length; i++)
			{
				if (points[i] != null)
				{
					var pt = new mxPoint(Math.round(points[i].x / scale * 10) / 10,
										Math.round(points[i].y / scale * 10) / 10);
					result[i] = pt;
				}
				else
				{
					result[i] = null;
				}
			}
		}
		else
		{
			result = null;
		}
		
		return result;
	},
	
	/**
	 * Function: scaleCellState
	 * 
	 * Scales an <mxCellState>
	 * 
	 * Parameters:
	 * 
	 * state - <mxCellState> to scale
	 * scale - the scaling to divide by
	 * 
	 */
	scaleCellState: function(state, scale)
	{
		var result = null;

		if (state != null)
		{
			result = state.clone();
			result.setRect(Math.round(state.x / scale * 10) / 10,
							Math.round(state.y / scale * 10) / 10,
							Math.round(state.width / scale * 10) / 10,
							Math.round(state.height / scale * 10) / 10);
		}
		else
		{
			result = null;
		}
		
		return result;
	},

	/**
	 * Function: OrthConnector
	 * 
	 * Implements a local orthogonal router between the given
	 * cells.
	 * 
	 * Parameters:
	 * 
	 * state - <mxCellState> that represents the edge to be updated.
	 * sourceScaled - <mxCellState> that represents the source terminal.
	 * targetScaled - <mxCellState> that represents the target terminal.
	 * controlHints - List of relative control points.
	 * result - Array of <mxPoints> that represent the actual points of the
	 * edge.
	 * 
	 */
	OrthConnector: function(state, sourceScaled, targetScaled, controlHints, result)
	{
		var graph = state.view.graph;

		var pts = mxEdgeStyle.scalePointArray(state.absolutePoints, state.view.scale);
		var source = mxEdgeStyle.scaleCellState(sourceScaled, state.view.scale);
		var target = mxEdgeStyle.scaleCellState(targetScaled, state.view.scale);

		var p0 = pts[0];
		var pe = pts[pts.length-1];
		
		var sourceX = source != null ? source.x : p0.x;
		var sourceY = source != null ? source.y : p0.y;
		var sourceWidth = source != null ? source.width : 1;
		var sourceHeight = source != null ? source.height : 1;
		
		var targetX = target != null ? target.x : pe.x;
		var targetY = target != null ? target.y : pe.y;
		var targetWidth = target != null ? target.width : 1;
		var targetHeight = target != null ? target.height : 1;

		var sourceBuffer = mxEdgeStyle.getJettySize(state, true);
		var targetBuffer = mxEdgeStyle.getJettySize(state, false);
		
		//console.log('sourceBuffer', sourceBuffer);
		//console.log('targetBuffer', targetBuffer);
		// Workaround for loop routing within buffer zone
		if (source != null && target == source)
		{
			targetBuffer = Math.max(sourceBuffer, targetBuffer);
			sourceBuffer = targetBuffer;
		}
		
		var totalBuffer = targetBuffer + sourceBuffer;
		// console.log('totalBuffer', totalBuffer);
		var tooShort = false;
		
		// Checks minimum distance for fixed points and falls back to segment connector
		if (p0 != null && pe != null)
		{
			var dx = pe.x - p0.x;
			var dy = pe.y - p0.y;
			
			tooShort = dx * dx + dy * dy < totalBuffer * totalBuffer;
		}

		if (tooShort || (mxEdgeStyle.orthPointsFallback && (controlHints != null &&
				controlHints.length > 0)))
		{
			mxEdgeStyle.SegmentConnector(state, sourceScaled, targetScaled, controlHints, result);
			
			return;
		}

		// Determine the side(s) of the source and target vertices
		// that the edge may connect to
		// portConstraint [source, target]
		var portConstraint = [mxConstants.DIRECTION_MASK_ALL, mxConstants.DIRECTION_MASK_ALL];
		var rotation = 0;
		
		if (source != null)
		{
			portConstraint[0] = mxUtils.getPortConstraints(source, state, true, 
					mxConstants.DIRECTION_MASK_ALL);
			rotation = mxUtils.getValue(source.style, mxConstants.STYLE_ROTATION, 0);
			
			//console.log('source rotation', rotation);
			
			if (rotation != 0)
			{
				var newRect = mxUtils.getBoundingBox(new mxRectangle(sourceX, sourceY, sourceWidth, sourceHeight), rotation);
				sourceX = newRect.x; 
				sourceY = newRect.y;
				sourceWidth = newRect.width;
				sourceHeight = newRect.height;
			}
		}

		if (target != null)
		{
			portConstraint[1] = mxUtils.getPortConstraints(target, state, false,
				mxConstants.DIRECTION_MASK_ALL);
			rotation = mxUtils.getValue(target.style, mxConstants.STYLE_ROTATION, 0);
			
			//console.log('target rotation', rotation);

			if (rotation != 0)
			{
				var newRect = mxUtils.getBoundingBox(new mxRectangle(targetX, targetY, targetWidth, targetHeight), rotation);
				targetX = newRect.x;
				targetY = newRect.y;
				targetWidth = newRect.width;
				targetHeight = newRect.height;
			}
		}

		//console.log('source' , sourceX, sourceY, sourceWidth, sourceHeight);
		//console.log('targetX' , targetX, targetY, targetWidth, targetHeight);
		
		if (sourceWidth == 0 || sourceHeight == 0 ||
			targetWidth == 0 || targetHeight == 0)
		{
			return;
		}

		var dir = [0, 0];

		// Work out which faces of the vertices present against each other
		// in a way that would allow a 3-segment connection if port constraints
		// permitted.
		// geo -> [source, target] [x, y, width, height]
		var geo = [ [sourceX, sourceY, sourceWidth, sourceHeight] ,
		            [targetX, targetY, targetWidth, targetHeight] ];
		var buffer = [sourceBuffer, targetBuffer];

		for (var i = 0; i < 2; i++)
		{
			mxEdgeStyle.limits[i][1] = geo[i][0] - buffer[i];
			mxEdgeStyle.limits[i][2] = geo[i][1] - buffer[i];
			mxEdgeStyle.limits[i][4] = geo[i][0] + geo[i][2] + buffer[i];
			mxEdgeStyle.limits[i][8] = geo[i][1] + geo[i][3] + buffer[i];
		}
		
		// Work out which quad the target is in
		var sourceCenX = geo[0][0] + geo[0][2] / 2.0;
		var sourceCenY = geo[0][1] + geo[0][3] / 2.0;
		var targetCenX = geo[1][0] + geo[1][2] / 2.0;
		var targetCenY = geo[1][1] + geo[1][3] / 2.0;
		
		var dx = sourceCenX - targetCenX;
		var dy = sourceCenY - targetCenY;

		var quad = 0;

		// 0 | 1
		// -----
		// 3 | 2
		
		if (dx < 0)
		{
			if (dy < 0)
			{
				quad = 2;
			}
			else
			{
				quad = 1;
			}
		}
		else
		{
			if (dy <= 0)
			{
				quad = 3;
				
				// Special case on x = 0 and negative y
				if (dx == 0)
				{
					quad = 2;
				}
			}
		}

		//console.log('quad', quad);

		// Check for connection constraints
		var currentTerm = null;
		
		if (source != null)
		{
			currentTerm = p0;
		}

		var constraint = [ [0.5, 0.5], [0.5, 0.5] ];

		// The only assumed cases for the below is an unattached end, source/target has no dims in that case.
		if (!source) constraint[0] = [0, 0];   // use top-left corner (= exact p0)
		if (!target) constraint[1] = [0, 0];   // use top-left corner (= exact pe)

		for (var i = 0; i < 2; i++)
		{
			if (currentTerm != null)
			{
				constraint[i][0] = (currentTerm.x - geo[i][0]) / geo[i][2];
				
				if (Math.abs(currentTerm.x - geo[i][0]) <= 1)
				{
					dir[i] = mxConstants.DIRECTION_MASK_WEST;
				}
				else if (Math.abs(currentTerm.x - geo[i][0] - geo[i][2]) <= 1)
				{
					dir[i] = mxConstants.DIRECTION_MASK_EAST;
				}

				constraint[i][1] = (currentTerm.y - geo[i][1]) / geo[i][3];

				if (Math.abs(currentTerm.y - geo[i][1]) <= 1)
				{
					dir[i] = mxConstants.DIRECTION_MASK_NORTH;
				}
				else if (Math.abs(currentTerm.y - geo[i][1] - geo[i][3]) <= 1)
				{
					dir[i] = mxConstants.DIRECTION_MASK_SOUTH;
				}
			}

			currentTerm = null;
			
			if (target != null)
			{
				currentTerm = pe;
			}
		}

		var sourceTopDist = geo[0][1] - (geo[1][1] + geo[1][3]);
		var sourceLeftDist = geo[0][0] - (geo[1][0] + geo[1][2]);
		var sourceBottomDist = geo[1][1] - (geo[0][1] + geo[0][3]);
		var sourceRightDist = geo[1][0] - (geo[0][0] + geo[0][2]);

		mxEdgeStyle.vertexSeperations[1] = Math.max(sourceLeftDist - totalBuffer, 0);
		mxEdgeStyle.vertexSeperations[2] = Math.max(sourceTopDist - totalBuffer, 0);
		mxEdgeStyle.vertexSeperations[4] = Math.max(sourceBottomDist - totalBuffer, 0);
		mxEdgeStyle.vertexSeperations[3] = Math.max(sourceRightDist - totalBuffer, 0);
				
		//==============================================================
		// Start of source and target direction determination

		// Work through the preferred orientations by relative positioning
		// of the vertices and list them in preferred and available order
		
		var dirPref = [];
		var horPref = [];
		var vertPref = [];

		horPref[0] = (sourceLeftDist >= sourceRightDist) ? mxConstants.DIRECTION_MASK_WEST
				: mxConstants.DIRECTION_MASK_EAST;
		vertPref[0] = (sourceTopDist >= sourceBottomDist) ? mxConstants.DIRECTION_MASK_NORTH
				: mxConstants.DIRECTION_MASK_SOUTH;

		horPref[1] = mxUtils.reversePortConstraints(horPref[0]);
		vertPref[1] = mxUtils.reversePortConstraints(vertPref[0]);
		
		var preferredHorizDist = sourceLeftDist >= sourceRightDist ? sourceLeftDist
				: sourceRightDist;
		var preferredVertDist = sourceTopDist >= sourceBottomDist ? sourceTopDist
				: sourceBottomDist;

		var prefOrdering = [ [0, 0] , [0, 0] ];
		var preferredOrderSet = false;

		// If the preferred port isn't available, switch it
		for (var i = 0; i < 2; i++)
		{
			if (dir[i] != 0x0)
			{
				continue;
			}

			if ((horPref[i] & portConstraint[i]) == 0)
			{
				horPref[i] = mxUtils.reversePortConstraints(horPref[i]);
			}

			if ((vertPref[i] & portConstraint[i]) == 0)
			{
				vertPref[i] = mxUtils
						.reversePortConstraints(vertPref[i]);
			}

			prefOrdering[i][0] = vertPref[i];
			prefOrdering[i][1] = horPref[i];
		}

		if (preferredVertDist > 0
				&& preferredHorizDist > 0)
		{
			// Possibility of two segment edge connection
			if (((horPref[0] & portConstraint[0]) > 0)
					&& ((vertPref[1] & portConstraint[1]) > 0))
			{
				prefOrdering[0][0] = horPref[0];
				prefOrdering[0][1] = vertPref[0];
				prefOrdering[1][0] = vertPref[1];
				prefOrdering[1][1] = horPref[1];
				preferredOrderSet = true;
			}
			else if (((vertPref[0] & portConstraint[0]) > 0)
					&& ((horPref[1] & portConstraint[1]) > 0))
			{
				prefOrdering[0][0] = vertPref[0];
				prefOrdering[0][1] = horPref[0];
				prefOrdering[1][0] = horPref[1];
				prefOrdering[1][1] = vertPref[1];
				preferredOrderSet = true;
			}
		}
		
		if (preferredVertDist > 0 && !preferredOrderSet)
		{
			prefOrdering[0][0] = vertPref[0];
			prefOrdering[0][1] = horPref[0];
			prefOrdering[1][0] = vertPref[1];
			prefOrdering[1][1] = horPref[1];
			preferredOrderSet = true;

		}
		
		if (preferredHorizDist > 0 && !preferredOrderSet)
		{
			prefOrdering[0][0] = horPref[0];
			prefOrdering[0][1] = vertPref[0];
			prefOrdering[1][0] = horPref[1];
			prefOrdering[1][1] = vertPref[1];
			preferredOrderSet = true;
		}

		// The source and target prefs are now an ordered list of
		// the preferred port selections
		// If the list contains gaps, compact it

		for (var i = 0; i < 2; i++)
		{
			if (dir[i] != 0x0)
			{
				continue;
			}

			if ((prefOrdering[i][0] & portConstraint[i]) == 0)
			{
				prefOrdering[i][0] = prefOrdering[i][1];
			}

			dirPref[i] = prefOrdering[i][0] & portConstraint[i];
			dirPref[i] |= (prefOrdering[i][1] & portConstraint[i]) << 8;
			dirPref[i] |= (prefOrdering[1 - i][i] & portConstraint[i]) << 16;
			dirPref[i] |= (prefOrdering[1 - i][1 - i] & portConstraint[i]) << 24;

			if ((dirPref[i] & 0xF) == 0)
			{
				dirPref[i] = dirPref[i] << 8;
			}
			
			if ((dirPref[i] & 0xF00) == 0)
			{
				dirPref[i] = (dirPref[i] & 0xF) | dirPref[i] >> 8;
			}
			
			if ((dirPref[i] & 0xF0000) == 0)
			{
				dirPref[i] = (dirPref[i] & 0xFFFF)
						| ((dirPref[i] & 0xF000000) >> 8);
			}

			dir[i] = dirPref[i] & 0xF;

			if (portConstraint[i] == mxConstants.DIRECTION_MASK_WEST
					|| portConstraint[i] == mxConstants.DIRECTION_MASK_NORTH
					|| portConstraint[i] == mxConstants.DIRECTION_MASK_EAST
					|| portConstraint[i] == mxConstants.DIRECTION_MASK_SOUTH)
			{
				dir[i] = portConstraint[i];
			}
		}

		//==============================================================
		// End of source and target direction determination

		var sourceIndex = dir[0] == mxConstants.DIRECTION_MASK_EAST ? 3
				: dir[0];
		var targetIndex = dir[1] == mxConstants.DIRECTION_MASK_EAST ? 3
				: dir[1];

		sourceIndex -= quad;
		targetIndex -= quad;

		if (sourceIndex < 1)
		{
			sourceIndex += 4;
		}
		
		if (targetIndex < 1)
		{
			targetIndex += 4;
		}

		var routePattern = mxEdgeStyle.routePatterns[sourceIndex - 1][targetIndex - 1];
		
		//console.log('routePattern', routePattern);

		mxEdgeStyle.wayPoints1[0][0] = geo[0][0];
		mxEdgeStyle.wayPoints1[0][1] = geo[0][1];

		switch (dir[0])
		{
			case mxConstants.DIRECTION_MASK_WEST:
				mxEdgeStyle.wayPoints1[0][0] -= sourceBuffer;
				mxEdgeStyle.wayPoints1[0][1] += constraint[0][1] * geo[0][3];
				break;
			case mxConstants.DIRECTION_MASK_SOUTH:
				mxEdgeStyle.wayPoints1[0][0] += constraint[0][0] * geo[0][2];
				mxEdgeStyle.wayPoints1[0][1] += geo[0][3] + sourceBuffer;
				break;
			case mxConstants.DIRECTION_MASK_EAST:
				mxEdgeStyle.wayPoints1[0][0] += geo[0][2] + sourceBuffer;
				mxEdgeStyle.wayPoints1[0][1] += constraint[0][1] * geo[0][3];
				break;
			case mxConstants.DIRECTION_MASK_NORTH:
				mxEdgeStyle.wayPoints1[0][0] += constraint[0][0] * geo[0][2];
				mxEdgeStyle.wayPoints1[0][1] -= sourceBuffer;
				break;
		}

		var currentIndex = 0;

		// Orientation, 0 horizontal, 1 vertical
		var lastOrientation = (dir[0] & (mxConstants.DIRECTION_MASK_EAST | mxConstants.DIRECTION_MASK_WEST)) > 0 ? 0
				: 1;
		var initialOrientation = lastOrientation;
		var currentOrientation = 0;

		for (var i = 0; i < routePattern.length; i++)
		{
			var nextDirection = routePattern[i] & 0xF;

			// Rotate the index of this direction by the quad
			// to get the real direction
			var directionIndex = nextDirection == mxConstants.DIRECTION_MASK_EAST ? 3
					: nextDirection;

			directionIndex += quad;

			if (directionIndex > 4)
			{
				directionIndex -= 4;
			}

			var direction = mxEdgeStyle.dirVectors[directionIndex - 1];

			currentOrientation = (directionIndex % 2 > 0) ? 0 : 1;
			// Only update the current index if the point moved
			// in the direction of the current segment move,
			// otherwise the same point is moved until there is 
			// a segment direction change
			if (currentOrientation != lastOrientation)
			{
				currentIndex++;
				// Copy the previous way point into the new one
				// We can't base the new position on index - 1
				// because sometime elbows turn out not to exist,
				// then we'd have to rewind.
				mxEdgeStyle.wayPoints1[currentIndex][0] = mxEdgeStyle.wayPoints1[currentIndex - 1][0];
				mxEdgeStyle.wayPoints1[currentIndex][1] = mxEdgeStyle.wayPoints1[currentIndex - 1][1];
			}

			var tar = (routePattern[i] & mxEdgeStyle.TARGET_MASK) > 0;
			var sou = (routePattern[i] & mxEdgeStyle.SOURCE_MASK) > 0;
			var side = (routePattern[i] & mxEdgeStyle.SIDE_MASK) >> 5;
			side = side << quad;

			if (side > 0xF)
			{
				side = side >> 4;
			}

			var center = (routePattern[i] & mxEdgeStyle.CENTER_MASK) > 0;

			if ((sou || tar) && side < 9)
			{
				var limit = 0;
				var souTar = sou ? 0 : 1;

				if (center && currentOrientation == 0)
				{
					limit = geo[souTar][0] + constraint[souTar][0] * geo[souTar][2];
				}
				else if (center)
				{
					limit = geo[souTar][1] + constraint[souTar][1] * geo[souTar][3];
				}
				else
				{
					limit = mxEdgeStyle.limits[souTar][side];
				}
				
				if (currentOrientation == 0)
				{
					var lastX = mxEdgeStyle.wayPoints1[currentIndex][0];
					var deltaX = (limit - lastX) * direction[0];

					if (deltaX > 0)
					{
						mxEdgeStyle.wayPoints1[currentIndex][0] += direction[0]
								* deltaX;
					}
				}
				else
				{
					var lastY = mxEdgeStyle.wayPoints1[currentIndex][1];
					var deltaY = (limit - lastY) * direction[1];

					if (deltaY > 0)
					{
						mxEdgeStyle.wayPoints1[currentIndex][1] += direction[1]
								* deltaY;
					}
				}
			}

			else if (center)
			{
				// Which center we're travelling to depend on the current direction
				mxEdgeStyle.wayPoints1[currentIndex][0] += direction[0]
						* Math.abs(mxEdgeStyle.vertexSeperations[directionIndex] / 2);
				mxEdgeStyle.wayPoints1[currentIndex][1] += direction[1]
						* Math.abs(mxEdgeStyle.vertexSeperations[directionIndex] / 2);
			}

			if (currentIndex > 0
					&& mxEdgeStyle.wayPoints1[currentIndex][currentOrientation] == mxEdgeStyle.wayPoints1[currentIndex - 1][currentOrientation])
			{
				currentIndex--;
			}
			else
			{
				lastOrientation = currentOrientation;
			}
		}

		for (var i = 0; i <= currentIndex; i++)
		{
			if (i == currentIndex)
			{
				// Last point can cause last segment to be in
				// same direction as jetty/approach. If so,
				// check the number of points is consistent
				// with the relative orientation of source and target
				// jx. Same orientation requires an even
				// number of turns (points), different requires
				// odd.
				var targetOrientation = (dir[1] & (mxConstants.DIRECTION_MASK_EAST | mxConstants.DIRECTION_MASK_WEST)) > 0 ? 0
						: 1;
				var sameOrient = targetOrientation == initialOrientation ? 0 : 1;

				// (currentIndex + 1) % 2 is 0 for even number of points,
				// 1 for odd
				if (sameOrient != (currentIndex + 1) % 2)
				{
					// The last point isn't required
					break;
				}
			}
			
			result.push(new mxPoint(Math.round(mxEdgeStyle.wayPoints1[i][0] * state.view.scale * 10) / 10,
									Math.round(mxEdgeStyle.wayPoints1[i][1] * state.view.scale * 10) / 10));
		}
		
		//console.log(result);

		// Removes duplicates
		var index = 1;
		
		while (index < result.length)
		{
			if (result[index - 1] == null || result[index] == null ||
				result[index - 1].x != result[index].x ||
				result[index - 1].y != result[index].y)
			{
				index++;
			}
			else
			{
				result.splice(index, 1);
			}
		}
	},
	
	getRoutePattern: function(dir, quad, dx, dy)
	{
		var sourceIndex = dir[0] == mxConstants.DIRECTION_MASK_EAST ? 3
				: dir[0];
		var targetIndex = dir[1] == mxConstants.DIRECTION_MASK_EAST ? 3
				: dir[1];

		sourceIndex -= quad;
		targetIndex -= quad;

		if (sourceIndex < 1)
		{
			sourceIndex += 4;
		}
		if (targetIndex < 1)
		{
			targetIndex += 4;
		}

		var result = routePatterns[sourceIndex - 1][targetIndex - 1];

		if (dx == 0 || dy == 0)
		{
			if (inlineRoutePatterns[sourceIndex - 1][targetIndex - 1] != null)
			{
				result = inlineRoutePatterns[sourceIndex - 1][targetIndex - 1];
			}
		}

		return result;
	}
};

export const mxPerimeter = {
	RectanglePerimeter: function (bounds, vertex, next, orthogonal)
	{
		var cx = bounds.getCenterX();
		var cy = bounds.getCenterY();
		var dx = next.x - cx;
		var dy = next.y - cy;
		var alpha = Math.atan2(dy, dx);
		var p = new mxPoint(0, 0);
		var pi = Math.PI;
		var pi2 = Math.PI/2;
		var beta = pi2 - alpha;
		var t = Math.atan2(bounds.height, bounds.width);
		
		if (alpha < -pi + t || alpha > pi - t)
		{
			// Left edge
			p.x = bounds.x;
			p.y = cy - bounds.width * Math.tan(alpha) / 2;
		}
		else if (alpha < -t)
		{
			// Top Edge
			p.y = bounds.y;
			p.x = cx - bounds.height * Math.tan(beta) / 2;
		}
		else if (alpha < t)
		{
			// Right Edge
			p.x = bounds.x + bounds.width;
			p.y = cy + bounds.width * Math.tan(alpha) / 2;
		}
		else
		{
			// Bottom Edge
			p.y = bounds.y + bounds.height;
			p.x = cx + bounds.height * Math.tan(beta) / 2;
		}
		
		if (orthogonal)
		{
			if (next.x >= bounds.x &&
				next.x <= bounds.x + bounds.width)
			{
				p.x = next.x;
			}
			else if (next.y >= bounds.y &&
					   next.y <= bounds.y + bounds.height)
			{
				p.y = next.y;
			}
			if (next.x < bounds.x)
			{
				p.x = bounds.x;
			}
			else if (next.x > bounds.x + bounds.width)
			{
				p.x = bounds.x + bounds.width;
			}
			if (next.y < bounds.y)
			{
				p.y = bounds.y;
			}
			else if (next.y > bounds.y + bounds.height)
			{
				p.y = bounds.y + bounds.height;
			}
		}
		
		return p;
	}
};
