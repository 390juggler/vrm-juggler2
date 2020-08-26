function getURLQueryStringParameterByName(name) {
	name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
	var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
		results = regex.exec(location.search);
	return results === null ? null : decodeURIComponent(results[1].replace(/\+/g, " "));
}
window.getURLQueryStringParameterByName = getURLQueryStringParameterByName;

/* used for deep cloning of various arrays/objects */
function cloneObject(obj) {
	var newObj = (obj instanceof Array) ? [] : {};
	for (var i in obj) {
		if (i == 'clone') continue;
		if (obj[i] && typeof obj[i] == "object") {
			newObj[i] = cloneObject(obj[i]);
		} else newObj[i] = obj[i]
	}
	return newObj;
}
window.cloneObject = cloneObject;

/* used to check if two states are the same */
function arraysEqual(a, b) {
	if (a instanceof Array && b instanceof Array) {
		if (a.length != b.length) {
			return false;
		} else {
			for (var i = 0; i < a.length; i++) {
				/* if this is a multi-dimensional array, check equality at the next level */
				if (a[i] instanceof Array || b[i] instanceof Array) {
					var tmp = arraysEqual(a[i], b[i]);
					if (!tmp) {
						return false;
					}
				} else if (a[i] != b[i]) {
					return false;
				}
			}
		}
	} else {
		return false;
	}
	return true;
}
window.arraysEqual = arraysEqual;

if (!Array.prototype.last) {
	Array.prototype.last = function() {
		return this[this.length - 1];
	};
}

if (!Array.prototype.getIndexCyclic) {
	Array.prototype.getIndexCyclic = function(i) {
		return this[i % this.length];
	};
}

if (!Array.prototype.getNextCyclic) {
	Array.prototype.getNextCyclic = function(i) {
		i = i % this.length;
		if (this.length - 1 == i) {
			return this[0];
		} else {
			return this[i + 1];
		}
	};
}

if (!Array.prototype.getPreviousCyclic) {
	Array.prototype.getPreviousCyclic = function(i) {
		i = i % this.length;
		if (i == 0) {
			return this[this.length - 1];
		} else {
			return this[i - 1];
		}
	};
}

function cross(a, b) {
	return {
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x
	}
}
window.cross = cross;

function dot(a, b) {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}
window.dot = dot;

function magnitude(a) {
	return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}
window.magnitude = magnitude;

function normalize(a) {
	var mag = magnitude(a);
	a.x = a.x / mag;
	a.y = a.y / mag;
	a.z = a.z / mag;
	return a;
}
window.normalize = normalize;

function multiply(a, b) {
	a.x *= b;
	a.y *= b;
	a.z *= b;
	return a;
}
window.multiply = multiply;

function add(a, b) {
	a.x += b.x;
	a.y += b.y;
	a.z += b.z;
	return a;
}
window.add = add;

function sub(a, b) {
	a.x -= b.x;
	a.y -= b.y;
	a.z -= b.z;
	return a;
}
window.sub = sub;

function negate(a) {
	multiply(a, -1);
	return a;
}
window.negate = negate;