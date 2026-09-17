extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var versions = load("res://addons/autov_avfx/shader_versions.gd")
	var count := 0
	for program in versions.EXPECTED:
		var shader = load("res://addons/autov_avfx/shaders/" + program + ".gdshader")
		if shader == null or shader.get_shader_uniform_list().is_empty():
			push_error("Shader compile failed: " + program)
			quit(1)
			return
		count += 1
	print("AVFX_SHADER_CHECK: ", count, " trusted programs compiled")
	quit(0)
