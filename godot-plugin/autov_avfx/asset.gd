@tool
extends Resource
## Imported, self-contained payload. Never executes bundle GLSL or source JSON.
@export var manifest: Dictionary = {}
@export var layers: Array[Dictionary] = []
@export var timeline: Dictionary = {}
@export var files: Dictionary = {}
