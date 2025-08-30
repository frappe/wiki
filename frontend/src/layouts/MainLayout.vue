<template>
	<div class="flex h-screen w-full flex-row shadow">
        <Sidebar />
        <div class="w-full">
            <Navbar />
			<div class="p-4">
				<slot></slot>
			</div>
        </div>
	</div>
</template>

<script setup>
import Navbar from '../components/Navbar.vue';
import Sidebar from '../components/Sidebar.vue';

</script>